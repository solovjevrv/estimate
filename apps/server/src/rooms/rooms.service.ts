import { randomUUID } from 'node:crypto';

import {
  GUEST_NAME_MAX_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  type Participant,
  type Room,
  type RoomRole,
  type RoomState,
  type Round,
  type RoundResult,
  type StartRoundPayload,
  type UpdateLinksPayload,
  hasTeamRole,
} from '@poker/shared';

import { UsersRepository } from '../auth';
import type { Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { TeamsRepository } from '../teams';

import type { ParticipantIdentity } from './presence';
import { RoomsRepository, type VoteRecord } from './rooms.repository';

export interface CreateRoomInput {
  name: string;
  teamId?: string | null;
}

/** Кто просится за стол: авторизованный пользователь или гость */
export interface JoinRequest {
  roomId: string;
  userId: string | null;
  guestName?: string | undefined;
  guestSessionId?: string | undefined;
}

/**
 * Правила комнат и раундов. Права проверяются здесь, а не на клиенте:
 * событие может прислать кто угодно, поэтому роль вычисляется на сервере
 * при каждом действии.
 */
export class RoomsService {
  constructor(
    private readonly db: Db,
    private readonly repository: RoomsRepository,
    private readonly teams: TeamsRepository,
    private readonly users: UsersRepository,
  ) {}

  static forDatabase(db: Db): RoomsService {
    return new RoomsService(
      db,
      new RoomsRepository(db),
      new TeamsRepository(db),
      new UsersRepository(db),
    );
  }

  async createRoom(actorId: string, input: CreateRoomInput): Promise<Room> {
    const name = this.normalizeName(input.name, ROOM_NAME_MAX_LENGTH, 'Название комнаты');
    const teamId = input.teamId ?? null;

    if (teamId) {
      // Комнату от лица команды заводят администратор и владелец
      const membership = await this.teams.findMembership(teamId, actorId);
      if (!membership) {
        throw new NotFoundError('Команда не найдена');
      }
      if (!hasTeamRole(membership.role, 'admin')) {
        throw new ForbiddenError('Создавать комнаты команды могут владелец и администратор');
      }
    }

    return this.repository.insertRoom(name, teamId, actorId);
  }

  /** Комната открыта по прямой ссылке — отдельных прав на просмотр нет */
  async getRoom(roomId: string): Promise<Room> {
    const room = await this.repository.findRoom(roomId);
    if (!room) {
      throw new NotFoundError('Комната не найдена');
    }
    return room;
  }

  async listTeamRooms(actorId: string, teamId: string): Promise<Room[]> {
    const membership = await this.teams.findMembership(teamId, actorId);
    if (!membership) {
      throw new NotFoundError('Команда не найдена');
    }
    return this.repository.listRoomsByTeam(teamId);
  }

  async listMyRooms(actorId: string): Promise<Room[]> {
    return this.repository.listPersonalRooms(actorId);
  }

  async closeRoom(actorId: string, roomId: string): Promise<Room> {
    const room = await this.getRoom(roomId);
    if ((await this.resolveRole(room, actorId)) !== 'scrum_master') {
      throw new ForbiddenError('Закрыть комнату может только скрам-мастер');
    }
    const closed = await this.repository.closeRoom(roomId);
    if (!closed) {
      throw new NotFoundError('Комната не найдена');
    }
    return closed;
  }

  /**
   * Роль в комнате: создатель — скрам-мастер, а для командных комнат
   * им же считаются владелец и администратор команды.
   */
  async resolveRole(room: Room, userId: string | null): Promise<RoomRole> {
    if (!userId) {
      return 'voter';
    }
    if (room.creatorId === userId) {
      return 'scrum_master';
    }
    if (room.teamId) {
      const membership = await this.teams.findMembership(room.teamId, userId);
      if (membership && hasTeamRole(membership.role, 'admin')) {
        return 'scrum_master';
      }
    }
    return 'voter';
  }

  /** Готовит участника к посадке за стол: проверяет комнату и собирает личность */
  async prepareJoin(request: JoinRequest): Promise<{ room: Room; identity: ParticipantIdentity }> {
    const room = await this.getRoom(request.roomId);

    if (request.userId) {
      const user = await this.users.findById(request.userId);
      if (!user) {
        // Аккаунт удалили, а кука осталась — за стол пускаем как гостя
        throw new ForbiddenError('Аккаунт не найден, войдите заново');
      }
      return {
        room,
        identity: {
          participantId: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl,
          isGuest: false,
          role: await this.resolveRole(room, user.id),
        },
      };
    }

    const name = this.normalizeName(request.guestName ?? '', GUEST_NAME_MAX_LENGTH, 'Имя');
    return {
      room,
      identity: {
        // Гость возвращается со своим сессионным id, чтобы не потерять голос
        participantId: request.guestSessionId?.trim() || randomUUID(),
        name,
        avatarUrl: null,
        isGuest: true,
        role: 'voter',
      },
    };
  }

  /** Снимок комнаты: текущий раунд, кто за столом и кто уже проголосовал */
  async getState(roomId: string, participants: ParticipantIdentity[]): Promise<RoomState> {
    const room = await this.getRoom(roomId);
    const round = await this.repository.findCurrentRound(roomId);
    const votes = round ? await this.repository.listVotes(round.id) : [];
    const voted = new Set(votes.map((vote) => vote.participantId));

    return {
      room,
      round,
      participants: participants.map((identity): Participant => ({
        participantId: identity.participantId,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
        isGuest: identity.isGuest,
        role: identity.role,
        hasVoted: voted.has(identity.participantId),
      })),
      // Оценки видны только после вскрытия карт
      result: round?.status === 'revealed' ? this.summarize(votes) : null,
    };
  }

  async submitVote(roomId: string, identity: ParticipantIdentity, value: number): Promise<void> {
    const round = await this.requireVotingRound(roomId);
    this.assertVoteValue(round, value);

    if (identity.isGuest) {
      await this.repository.upsertGuestVote(round.id, identity.participantId, identity.name, value);
      return;
    }
    await this.repository.upsertUserVote(round.id, identity.participantId, value);
  }

  /** Вскрытие карт: считаем средний балл и фиксируем его в раунде */
  async revealCards(roomId: string, identity: ParticipantIdentity): Promise<RoundResult> {
    this.assertScrumMaster(identity, 'Вскрыть карты может только скрам-мастер');

    return this.db.transaction(async (tx) => {
      const repo = new RoomsRepository(tx);
      const room = await repo.lockRoom(roomId);
      if (!room) {
        throw new NotFoundError('Комната не найдена');
      }
      const round = await repo.findCurrentRound(roomId);
      if (!round) {
        throw new ConflictError('В комнате ещё нет раунда');
      }

      const votes = await repo.listVotes(round.id);
      if (votes.length === 0) {
        throw new ConflictError('Никто ещё не проголосовал');
      }
      const result = this.summarize(votes);

      if (round.status === 'voting') {
        await repo.markRevealed(round.id, result.average);
      }
      return result;
    });
  }

  async startNewRound(
    roomId: string,
    identity: ParticipantIdentity,
    payload: StartRoundPayload,
  ): Promise<Round> {
    this.assertScrumMaster(identity, 'Начать новый раунд может только скрам-мастер');

    return this.db.transaction(async (tx) => {
      const repo = new RoomsRepository(tx);
      const room = await repo.lockRoom(roomId);
      if (!room) {
        throw new NotFoundError('Комната не найдена');
      }
      if (room.status === 'closed') {
        throw new ConflictError('Комната закрыта');
      }

      const current = await repo.findCurrentRound(roomId);
      return repo.insertRound({
        roomId,
        seq: (current?.seq ?? 0) + 1,
        deckType: payload.deckType,
        jiraUrl: this.normalizeLink(payload.jiraUrl),
        confluenceUrl: this.normalizeLink(payload.confluenceUrl),
      });
    });
  }

  /** Ссылки на задачу может править любой участник — так решено в Epic 5 */
  async updateLinks(roomId: string, links: UpdateLinksPayload): Promise<Round> {
    const room = await this.getRoom(roomId);
    if (room.status === 'closed') {
      throw new ConflictError('Комната закрыта');
    }
    const round = await this.repository.findCurrentRound(roomId);
    if (!round) {
      throw new ConflictError('В комнате ещё нет раунда');
    }

    const patch: UpdateLinksPayload = {};
    if (links.jiraUrl !== undefined) patch.jiraUrl = this.normalizeLink(links.jiraUrl);
    if (links.confluenceUrl !== undefined) {
      patch.confluenceUrl = this.normalizeLink(links.confluenceUrl);
    }

    const updated = await this.repository.updateRoundLinks(round.id, patch);
    if (!updated) {
      throw new NotFoundError('Раунд не найден');
    }
    return updated;
  }

  private async requireVotingRound(roomId: string): Promise<Round> {
    const room = await this.getRoom(roomId);
    if (room.status === 'closed') {
      throw new ConflictError('Комната закрыта');
    }
    const round = await this.repository.findCurrentRound(roomId);
    if (!round) {
      throw new ConflictError('В комнате ещё нет раунда');
    }
    if (round.status !== 'voting') {
      throw new ConflictError('Карты уже вскрыты, дождитесь нового раунда');
    }
    return round;
  }

  private assertScrumMaster(identity: ParticipantIdentity, message: string): void {
    if (identity.role !== 'scrum_master') {
      throw new ForbiddenError(message);
    }
  }

  private assertVoteValue(round: Round, value: number): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new ValidationError('Оценка должна быть целым неотрицательным числом');
    }
    // У колоды Фибоначчи можно добавить своё число, у шкалы предел жёсткий
    if (round.deckType === 'scale_0_5' && value > 5) {
      throw new ValidationError('Для шкалы допустимы значения от 0 до 5');
    }
  }

  private summarize(votes: VoteRecord[]): RoundResult {
    const values = votes.map((vote) => vote.value);
    const sum = values.reduce((total, value) => total + value, 0);

    return {
      // Простое среднее по всем голосам, крайние не отбрасываем
      average: Math.round((sum / values.length) * 100) / 100,
      min: Math.min(...values),
      max: Math.max(...values),
      votes: votes.map((vote) => ({
        participantId: vote.participantId,
        name: vote.name ?? 'Участник',
        value: vote.value,
      })),
    };
  }

  private normalizeName(raw: string, maxLength: number, field: string): string {
    const value = raw.trim();
    if (value.length === 0 || value.length > maxLength) {
      throw new ValidationError(`${field}: от 1 до ${maxLength} символов`);
    }
    return value;
  }

  /** Пустая строка означает «ссылку убрали» */
  private normalizeLink(raw: string | null | undefined): string | null {
    const value = raw?.trim();
    if (!value) {
      return null;
    }
    if (!/^https?:\/\//i.test(value)) {
      throw new ValidationError('Ссылка должна начинаться с http:// или https://');
    }
    return value;
  }
}
