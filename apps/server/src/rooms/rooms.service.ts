import {
  GUEST_NAME_MAX_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  type Participant,
  type Room,
  type RoomRole,
  type RoomState,
  type RevealCardsPayload,
  type Round,
  type RoundResult,
  type DeckType,
  type RoomTimerState,
  type StartRoundPayload,
  type SubmitVotePayload,
  type UpdateLinksPayload,
  DECK_TYPES,
  TIMER_DEFAULT_DURATION_SEC,
  TSHIRT_DECK,
  hasTeamRole,
} from '@poker/shared';

import { UsersRepository } from '../auth';
import type { Db } from '../db';
import { isForeignKeyViolation, isUniqueViolation } from '../db/errors';
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

/** Внешние ключи голоса: по ним отличаем удалённый раунд от удалённого аккаунта */
const VOTE_ROUND_FK = 'votes_round_id_rounds_id_fk';
const VOTE_USER_FK = 'votes_user_id_users_id_fk';

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
      // Комнату от лица команды заводит администратор
      const membership = await this.teams.findMembership(teamId, actorId);
      if (!membership) {
        throw new NotFoundError('Команда не найдена');
      }
      if (!hasTeamRole(membership.role, 'admin')) {
        throw new ForbiddenError('Создавать комнаты команды может администратор');
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

  async listTeamRooms(actorId: string, teamId: string, archived = false): Promise<Room[]> {
    const membership = await this.teams.findMembership(teamId, actorId);
    if (!membership) {
      throw new NotFoundError('Команда не найдена');
    }
    // Архив команды видит только администратор — обычный список открыт всем участникам
    if (archived && !hasTeamRole(membership.role, 'admin')) {
      throw new ForbiddenError('Архив комнат команды видит только администратор');
    }
    return this.repository.listRoomsByTeam(teamId, archived);
  }

  /** И личные комнаты, и командные — всё, что пользователь создал сам */
  async listMyRooms(actorId: string, archived = false): Promise<Room[]> {
    return this.repository.listRoomsCreatedBy(actorId, archived);
  }

  /**
   * Архивация — единственный способ «убрать» комнату из основных списков. Настоящее
   * удаление доступно отдельным действием и только для уже заархивированной комнаты.
   *
   * Роль проверяется под той же блокировкой строки комнаты, что и мутация — иначе
   * между чтением роли и записью успело бы пройти чужое понижение/исключение из
   * команды, и запрос выполнился бы уже от имени бывшего администратора.
   */
  async archiveRoom(actorId: string, roomId: string): Promise<Room> {
    return this.withLockedRoom(roomId, async (repo, room, teams) => {
      if ((await this.resolveRole(room, actorId, teams)) !== 'scrum_master') {
        throw new ForbiddenError('Архивировать комнату может только скрам-мастер');
      }
      if (room.archivedAt) {
        throw new ConflictError('Комната уже в архиве');
      }
      const archived = await repo.archiveRoom(roomId);
      if (!archived) {
        throw new ConflictError('Комната уже в архиве');
      }
      return archived;
    });
  }

  /** Необратимо: раунды и голоса комнаты удаляются каскадом на уровне БД */
  async deleteRoomPermanently(actorId: string, roomId: string): Promise<void> {
    await this.withLockedRoom(roomId, async (repo, room, teams) => {
      if ((await this.resolveRole(room, actorId, teams)) !== 'scrum_master') {
        throw new ForbiddenError('Удалить комнату может только скрам-мастер');
      }
      if (!room.archivedAt) {
        throw new ConflictError('Сначала заархивируйте комнату');
      }
      const deleted = await repo.deleteArchivedRoom(roomId);
      if (!deleted) {
        throw new NotFoundError('Комната не найдена');
      }
    });
  }

  /** Таймер обсуждения — эфемерное состояние, но архив всё равно read-only */
  async assertRoomOpen(roomId: string): Promise<void> {
    const room = await this.getRoom(roomId);
    if (room.archivedAt) {
      throw new ConflictError('Комната в архиве');
    }
  }

  /**
   * Роль в комнате: создатель — скрам-мастер, а для командных комнат
   * им же считается администратор команды.
   */
  async resolveRole(
    room: Room,
    userId: string | null,
    teams: TeamsRepository = this.teams,
  ): Promise<RoomRole> {
    if (!userId) {
      return 'voter';
    }
    if (room.creatorId === userId) {
      return 'scrum_master';
    }
    if (room.teamId) {
      const membership = await teams.findMembership(room.teamId, userId);
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
    // подписанный токен, а не сам идентификатор. Токен проверяется именно на
    // эту комнату — токен другой комнаты сюда не подходит.
    const returning = this.guests.verify(room.id, request.guestToken);
    const session = returning
      ? { guestId: returning, token: this.guests.issue(room.id, returning) }
      : this.guests.create(room.id);

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

  /**
   * Снимок комнаты: текущий раунд, кто за столом и кто уже проголосовал.
   * Читается одним снимком базы, иначе между запросами успевает пройти вскрытие
   * карт и участники получат рваную картину: раунд ещё открыт, а голоса финальные.
   */
  async getState(
    roomId: string,
    participants: ParticipantIdentity[],
    timer: RoomTimerState = {
      durationSec: TIMER_DEFAULT_DURATION_SEC,
      running: false,
      endsAt: null,
      remainingSec: TIMER_DEFAULT_DURATION_SEC,
    },
  ): Promise<RoomState> {
    const { room, round, votes } = await this.db.transaction(
      async (tx) => {
        const repo = new RoomsRepository(tx);
        const found = await repo.findRoom(roomId);
        if (!found) {
          throw new NotFoundError('Комната не найдена');
        }
        const current = await repo.findCurrentRound(roomId);
        return {
          room: found,
          round: current,
          votes: current ? await repo.listVotes(current.id) : [],
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
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
      result: round?.status === 'revealed' ? this.summarize(votes, round, round.average) : null,
      timer,
    };
  }

  /**
   * Приём оценки. Идёт под той же блокировкой комнаты, что вскрытие карт и
   * смена раунда: иначе голос успевал лечь между подсчётом среднего и его
   * записью — в раунде оставалось одно число, а участники видели другое.
   */
  async submitVote(
    roomId: string,
    identity: ParticipantIdentity,
    payload: SubmitVotePayload,
  ): Promise<void> {
    const value = payload.value;

    await this.inRoom(roomId, async (repo) => {
      const round = await repo.findCurrentRound(roomId);
      if (!round) {
        throw new ConflictError('В комнате ещё нет раунда');
      }
      // Клиент говорит, за какой раунд голосует: пока оценка ждала очереди,
      // скрам-мастер мог начать следующую задачу
      if (payload.roundId != null && payload.roundId !== round.id) {
        throw new ConflictError('Раунд уже сменился, посмотрите новую задачу');
      }
      if (round.status !== 'voting') {
        throw new ConflictError('Карты уже вскрыты, дождитесь нового раунда');
      }
      this.assertVoteValue(round, value);

      try {
        if (identity.isGuest) {
          await repo.upsertGuestVote(round.id, identity.participantId, identity.name, value);
        } else {
          await repo.upsertUserVote(round.id, identity.participantId, value);
        }
      } catch (err) {
        this.rethrowVoteFailure(err);
      }
      await repo.bumpRevision(roomId);
    });
  }

  /** Вскрытие карт: считаем средний балл и фиксируем его в раунде */
  async revealCards(
    roomId: string,
    identity: ParticipantIdentity,
    payload: RevealCardsPayload = {},
  ): Promise<RoundResult> {
    return this.inRoom(roomId, async (repo, room, teams) => {
      await this.assertScrumMaster(
        room,
        identity,
        'Вскрыть карты может только скрам-мастер',
        teams,
      );
      const round = await repo.findCurrentRound(roomId);
      if (!round) {
        throw new ConflictError('В комнате ещё нет раунда');
      }
      // Пока команда ждала очереди, скрам-мастер мог начать следующую задачу —
      // её карты вскрывать рано
      if (payload.roundId != null && payload.roundId !== round.id) {
        throw new ConflictError('Раунд уже сменился, вскрывать нужно новую задачу');
      }

      const votes = await repo.listVotes(round.id);
      if (votes.length === 0) {
        throw new ConflictError('Никто ещё не проголосовал');
      }
      // Карты могли вскрыть, пока запрос ждал блокировки — тогда показываем зафиксированное
      if (round.status !== 'voting') {
        return this.summarize(votes, round, round.average);
      }

      const result = this.summarize(votes, round);
      await repo.markRevealed(round.id, result.average);
      await repo.bumpRevision(roomId);
      return result;
    });
  }

  async startNewRound(
    roomId: string,
    identity: ParticipantIdentity,
    payload: StartRoundPayload,
  ): Promise<Round> {
    const deckType = this.requireDeckType(payload?.deckType);

    return this.inRoom(roomId, async (repo, room, teams) => {
      await this.assertScrumMaster(
        room,
        identity,
        'Начать новый раунд может только скрам-мастер',
        teams,
      );

      const current = await repo.findCurrentRound(roomId);
      // Клиент говорит, какой раунд он видел текущим. Если стол уже ушёл вперёд,
      // отдаём его раунд: двойной клик и два скрам-мастера не наплодят пустых раундов
      if (payload.fromRoundId !== undefined && (current?.id ?? null) !== payload.fromRoundId) {
        if (!current) {
          throw new ConflictError('Раунд не найден, обновите страницу');
        }
        return current;
      }

      const started = await repo.insertRound({
        roomId,
        seq: (current?.seq ?? 0) + 1,
        deckType,
      });
      await repo.bumpRevision(roomId);
      return started;
    });
  }

  /** Ссылки на задачу принадлежат комнате целиком, менять может любой участник — Epic 5 / 7.25 */
  async updateLinks(roomId: string, links: UpdateLinksPayload): Promise<Room> {
    const patch: UpdateLinksPayload = {};
    if (links.jiraUrl !== undefined) patch.jiraUrl = this.normalizeLink(links.jiraUrl);
    if (links.confluenceUrl !== undefined) {
      patch.confluenceUrl = this.normalizeLink(links.confluenceUrl);
    }

    return this.inRoom(roomId, async (repo, room) => {
      // Версию присылает клиент: если её нет, правка идёт по-старому — побеждает последний
      const version = links.version ?? undefined;
      if (version !== undefined && version !== room.linksVersion) {
        throw new ConflictError('Ссылки уже изменил другой участник, проверьте новые значения');
      }
      // Править нечего — версию не трогаем, иначе чужие правки начнут отбиваться конфликтом
      if (Object.keys(patch).length === 0) {
        return room;
      }

      const updated = await repo.updateRoomLinks(roomId, patch, version);
      if (!updated) {
        throw new ConflictError('Ссылки уже изменил другой участник, проверьте новые значения');
      }
      await repo.bumpRevision(roomId);
      return updated;
    });
  }

  /**
   * Действие над столом под блокировкой комнаты. Все изменения раундов и
   * голосов идут через неё, поэтому выполняются строго по очереди — так снята
   * гонка между голосованием, вскрытием карт и сменой раунда. Архивная комната
   * доступна только для чтения — сюда так не попасть.
   */
  private async inRoom<T>(
    roomId: string,
    action: (repo: RoomsRepository, room: Room, teams: TeamsRepository) => Promise<T>,
  ): Promise<T> {
    return this.withLockedRoom(roomId, async (repo, room, teams) => {
      if (room.archivedAt) {
        throw new ConflictError('Комната в архиве');
      }
      return action(repo, room, teams);
    });
  }

  /**
   * Комната под блокировкой строки, без проверки архивности — её решает вызывающий
   * (у архивации и удаления архивной комнаты разные требования к этому флагу).
   *
   * Репозиторий команд тоже берётся от транзакции: иначе действие, уже
   * державшее соединение пула, просило бы из него второе — и при полном пуле
   * стол вставал бы намертво.
   */
  private async withLockedRoom<T>(
    roomId: string,
    action: (repo: RoomsRepository, room: Room, teams: TeamsRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const repo = new RoomsRepository(tx);
      const room = await repo.lockRoom(roomId);
      if (!room) {
        throw new NotFoundError('Комната не найдена');
      }
      return action(repo, room, new TeamsRepository(tx));
    });
  }

  /** Стол мог исчезнуть под руками: раунд удалили вместе с комнатой, аккаунт — вместе с сессией */
  private rethrowVoteFailure(err: unknown): never {
    if (isForeignKeyViolation(err, VOTE_ROUND_FK)) {
      throw new ConflictError('Раунд уже завершён, обновите страницу');
    }
    if (isForeignKeyViolation(err, VOTE_USER_FK)) {
      throw new ForbiddenError('Аккаунт не найден, войдите заново');
    }
    // Страховка: голос того же участника в тот же раунд уже есть
    if (isUniqueViolation(err)) {
      throw new ConflictError('Не удалось учесть оценку, попробуйте ещё раз');
    }
    throw err;
  }

  /**
   * Роль перечитывается на каждом действии: за время сессии владение командой
   * могли передать, а слепок с момента входа об этом не знает.
   */
  private async assertScrumMaster(
    room: Room,
    identity: ParticipantIdentity,
    message: string,
    teams: TeamsRepository,
  ): Promise<void> {
    if ((await this.resolveRole(room, identity.userId, teams)) !== 'scrum_master') {
      throw new ForbiddenError(message);
    }
  }

  private assertVoteValue(round: Round, value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_VOTE_VALUE) {
      throw new ValidationError(`Оценка должна быть целым числом от 0 до ${MAX_VOTE_VALUE}`);
    }
    // У колоды Фибоначчи можно добавить своё число, у шкалы и футболочных размеров — только из колоды
    if (round.deckType === 'scale_0_5' && value > 5) {
      throw new ValidationError('Для шкалы допустимы значения от 0 до 5');
    }
    if (round.deckType === 'tshirt' && !TSHIRT_DECK.includes(value)) {
      throw new ValidationError('Для футболочных размеров допустимы только числа из колоды');
    }
  }

  /** Если раунд уже вскрыт, показываем зафиксированное среднее, а не пересчитанное */
  private summarize(votes: VoteRecord[], round: Round, stored: number | null = null): RoundResult {
    const values = votes.map((vote) => vote.value);
    const sum = values.reduce((total, value) => total + value, 0);
    // Для футболочных размеров среднее числового веса не несёт смысла — не считаем
    const average =
      round.deckType === 'tshirt'
        ? null
        : (stored ?? Math.round((sum / values.length) * 100) / 100);

    return {
      average,
      min: Math.min(...values),
      max: Math.max(...values),
      agreement: this.calculateAgreement(values),
      votes: votes.map((vote) => ({
        participantId: vote.participantId,
        name: vote.name ?? 'Участник',
        value: vote.value,
      })),
    };
  }

  /** Доля проголосовавших за самое частое значение — метрика согласия команды */
  private calculateAgreement(values: number[]): number {
    const counts = new Map<number, number>();
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const maxCount = Math.max(...counts.values());
    return Math.round((maxCount / values.length) * 100);
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
