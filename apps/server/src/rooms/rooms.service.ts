import {
  GUEST_NAME_MAX_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  type Participant,
  type Room,
  type RoomRole,
  type RoomState,
  type Round,
  type RoundResult,
  type DeckType,
  type StartRoundPayload,
  type UpdateLinksPayload,
  DECK_TYPES,
  hasTeamRole,
} from '@poker/shared';

import { UsersRepository } from '../auth';
import type { Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { TeamsRepository } from '../teams';

import { GuestSessions } from './guest-sessions';
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
  /** Подписанный токен из прошлого захода — по нему гость забирает свою личность */
  guestToken?: string | undefined;
}

export interface JoinResult {
  room: Room;
  identity: ParticipantIdentity;
  /** Выдаётся гостю: сохранить и прислать при переподключении */
  guestToken: string | null;
}

/** Верхняя граница оценки: защищает от переполнения integer в базе */
const MAX_VOTE_VALUE = 1000;
const MAX_LINK_LENGTH = 2000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    private readonly guests: GuestSessions,
  ) {}

  static forDatabase(db: Db, guestSecret: string): RoomsService {
    return new RoomsService(
      db,
      new RoomsRepository(db),
      new TeamsRepository(db),
      new UsersRepository(db),
      new GuestSessions(guestSecret),
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
  async prepareJoin(request: JoinRequest): Promise<JoinResult> {
    const room = await this.getRoom(this.requireUuid(request.roomId, 'комнаты'));

    if (request.userId) {
      const user = await this.users.findById(request.userId);
      if (!user) {
        throw new ForbiddenError('Аккаунт не найден, войдите заново');
      }
      return {
        room,
        guestToken: null,
        identity: {
          participantId: user.id,
          userId: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl,
          isGuest: false,
          role: await this.resolveRole(room, user.id),
        },
      };
    }

    const name = this.normalizeName(request.guestName ?? '', GUEST_NAME_MAX_LENGTH, 'Имя');
    // Идентификатор гостя виден всем за столом, поэтому личность подтверждает
    // подписанный токен, а не сам идентификатор
    const returning = this.guests.verify(request.guestToken);
    const session = returning
      ? { guestId: returning, token: this.guests.issue(returning) }
      : this.guests.create();

    return {
      room,
      guestToken: session.token,
      identity: {
        participantId: session.guestId,
        userId: null,
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
      result: round?.status === 'revealed' ? this.summarize(votes, round.average) : null,
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
    return this.db.transaction(async (tx) => {
      const repo = new RoomsRepository(tx);
      const room = await repo.lockRoom(roomId);
      if (!room) {
        throw new NotFoundError('Комната не найдена');
      }
      await this.assertScrumMaster(room, identity, 'Вскрыть карты может только скрам-мастер');
      if (room.status === 'closed') {
        throw new ConflictError('Комната закрыта');
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
    const deckType = this.requireDeckType(payload?.deckType);

    return this.db.transaction(async (tx) => {
      const repo = new RoomsRepository(tx);
      const room = await repo.lockRoom(roomId);
      if (!room) {
        throw new NotFoundError('Комната не найдена');
      }
      await this.assertScrumMaster(room, identity, 'Начать новый раунд может только скрам-мастер');
      if (room.status === 'closed') {
        throw new ConflictError('Комната закрыта');
      }

      const current = await repo.findCurrentRound(roomId);
      return repo.insertRound({
        roomId,
        seq: (current?.seq ?? 0) + 1,
        deckType,
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

  /**
   * Роль перечитывается на каждом действии: за время сессии владение командой
   * могли передать, а слепок с момента входа об этом не знает.
   */
  private async assertScrumMaster(
    room: Room,
    identity: ParticipantIdentity,
    message: string,
  ): Promise<void> {
    if ((await this.resolveRole(room, identity.userId)) !== 'scrum_master') {
      throw new ForbiddenError(message);
    }
  }

  private assertVoteValue(round: Round, value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_VOTE_VALUE) {
      throw new ValidationError(`Оценка должна быть целым числом от 0 до ${MAX_VOTE_VALUE}`);
    }
    // У колоды Фибоначчи можно добавить своё число, у шкалы предел жёсткий
    if (round.deckType === 'scale_0_5' && value > 5) {
      throw new ValidationError('Для шкалы допустимы значения от 0 до 5');
    }
  }

  /** Если раунд уже вскрыт, показываем зафиксированное среднее, а не пересчитанное */
  private summarize(votes: VoteRecord[], stored: number | null = null): RoundResult {
    const values = votes.map((vote) => vote.value);
    const sum = values.reduce((total, value) => total + value, 0);

    return {
      // Простое среднее по всем голосам, крайние не отбрасываем
      average: stored ?? Math.round((sum / values.length) * 100) / 100,
      min: Math.min(...values),
      max: Math.max(...values),
      votes: votes.map((vote) => ({
        participantId: vote.participantId,
        name: vote.name ?? 'Участник',
        value: vote.value,
      })),
    };
  }

  /** Идентификаторы приходят по сокету без схем — проверяем формат до похода в базу */
  private requireUuid(value: string, what: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new ValidationError(`Некорректный идентификатор ${what}`);
    }
    return value;
  }

  private requireDeckType(value: unknown): DeckType {
    if (!DECK_TYPES.includes(value as DeckType)) {
      throw new ValidationError('Неизвестный тип колоды');
    }
    return value as DeckType;
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
    const value = typeof raw === 'string' ? raw.trim() : null;
    if (!value) {
      return null;
    }
    if (value.length > MAX_LINK_LENGTH) {
      throw new ValidationError('Ссылка слишком длинная');
    }
    if (!/^https?:\/\//i.test(value)) {
      throw new ValidationError('Ссылка должна начинаться с http:// или https://');
    }
    return value;
  }
}
