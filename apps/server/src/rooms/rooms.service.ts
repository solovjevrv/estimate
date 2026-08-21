import {
  GUEST_NAME_MAX_LENGTH,
  isHttpUrl,
  isTextLengthInRange,
  isValidUuid,
  ROOM_LINK_MAX_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  trimOptionalText,
  trimText,
  type Participant,
  type Reaction,
  type Room,
  type RoomRole,
  type RoomState,
  type RevealCardsPayload,
  type RoomStats,
  type Round,
  type RoundHistoryEntry,
  type RoundResult,
  type DeckType,
  type RoomTimerState,
  type StartRoundPayload,
  type SubmitVotePayload,
  type UpdateLinksPayload,
  DECK_TYPES,
  TIMER_DEFAULT_DURATION_SEC,
  TSHIRT_DECK,
} from '@poker/shared';

import { TeamAccess } from '../access';
import { UsersRepository } from '../auth';
import type { DbExecutor } from '../common/db-executor';
import type { Db } from '../db';
import { isForeignKeyViolation, isUniqueViolation } from '../db/errors';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { GuestSessions } from '../platform/realtime';

import type { ParticipantIdentity } from './presence';
import { resolveRoomRole } from './rooms.policy';
import { summarizeRound } from './round-scoring';
import { type DbExecutor as RoomsDbExecutor, RoomsRepository } from './rooms.repository';

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

/** Хватает с большим запасом на реальные сценарии; пейджинг пока не нужен */
const ROUND_HISTORY_LIMIT = 50;

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
    private readonly teams: TeamAccess,
    private readonly users: UsersRepository,
    private readonly guests: GuestSessions,
    /**
     * Репозитории для действий под транзакцией (`getState`/`withLockedRoom`) —
     * фабрики, а не прямой `new RoomsRepository(tx)`, чтобы в юнит-тестах можно
     * было подменить их моками и не поднимать реальную БД (7.30).
     */
    private readonly createRoomsRepository: (executor: RoomsDbExecutor) => RoomsRepository = (
      executor,
    ) => new RoomsRepository(executor),
    private readonly createTeamAccess: (executor: DbExecutor) => TeamAccess = (executor) =>
      TeamAccess.forExecutor(executor),
  ) {}

  static forDatabase(db: Db, guestSecret: string): RoomsService {
    return new RoomsService(
      db,
      new RoomsRepository(db),
      TeamAccess.forExecutor(db),
      new UsersRepository(db),
      new GuestSessions(guestSecret, 'guest'),
    );
  }

  async createRoom(actorId: string, input: CreateRoomInput): Promise<Room> {
    const name = this.normalizeName(input.name, ROOM_NAME_MAX_LENGTH, 'Название комнаты');
    const teamId = input.teamId ?? null;

    if (teamId) {
      // Комнату от лица команды заводит администратор
      await this.teams.require(
        teamId,
        actorId,
        'admin',
        'Создавать комнаты команды может администратор',
      );
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
    // Обычный список открыт любому участнику команды, архив — только администратору.
    // `guest` — младшая роль, на этой ветке проверка сводится к самому членству
    // и текстом про архив ответить не может.
    await this.teams.require(
      teamId,
      actorId,
      archived ? 'admin' : 'guest',
      'Архив комнат команды видит только администратор',
    );
    return this.repository.listRoomsByTeam(teamId, archived);
  }

  /** И личные комнаты, и командные — всё, что пользователь создал сам */
  async listMyRooms(actorId: string, archived = false): Promise<Room[]> {
    return this.repository.listRoomsCreatedBy(actorId, archived);
  }

  /**
   * История вскрытых раундов комнаты с их итогами — комната открыта по прямой
   * ссылке, поэтому доступна так же, как и сама комната (без проверки роли).
   */
  async listRoundHistory(roomId: string): Promise<RoundHistoryEntry[]> {
    await this.getRoom(roomId);
    const rounds = await this.repository.listRevealedRounds(roomId, ROUND_HISTORY_LIMIT);
    const votesByRound = await this.repository.listVotesForRounds(rounds.map((round) => round.id));
    // Раунд без единого голоса при вскрытии невозможен (revealCards это проверяет),
    // но со временем голос мог уйти каскадом вместе с удалённым аккаунтом (7.10) —
    // summarize() на пустом массиве даёт NaN/Infinity, такой раунд лучше пропустить
    return rounds.flatMap((round) => {
      const votes = votesByRound.get(round.id) ?? [];
      return votes.length === 0
        ? []
        : [{ round, result: summarizeRound(votes, round.deckType, round.average) }];
    });
  }

  /** Раундов сыграно, задач оценено и среднее время раунда — по всем комнатам пользователя */
  async getMyStats(actorId: string): Promise<RoomStats> {
    return this.repository.roomStats(actorId);
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

  /**
   * Переименование — как и архивация, доступно только скрам-мастеру. В отличие
   * от голосования, метаданные комнаты можно поправить и после архивации
   * (например, задним числом уточнить название задачи в истории).
   */
  async renameRoom(actorId: string, roomId: string, rawName: string): Promise<Room> {
    const name = this.normalizeName(rawName, ROOM_NAME_MAX_LENGTH, 'Название комнаты');
    return this.withLockedRoom(roomId, async (repo, room, teams) => {
      if ((await this.resolveRole(room, actorId, teams)) !== 'scrum_master') {
        throw new ForbiddenError('Переименовать комнату может только скрам-мастер');
      }
      const updated = await repo.updateRoomName(roomId, name);
      if (!updated) {
        throw new NotFoundError('Комната не найдена');
      }
      return updated;
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

  /**
   * Право исключить участника — только у скрам-мастера. Само исключение (поиск
   * сокета участника и обрыв соединения) сервису не подвластно — он ничего не
   * знает о сокетах, этим занимается шлюз.
   */
  async assertCanKick(roomId: string, identity: ParticipantIdentity): Promise<void> {
    const room = await this.getRoom(roomId);
    if ((await this.resolveRole(room, identity.userId)) !== 'scrum_master') {
      throw new ForbiddenError('Исключать участников может только скрам-мастер');
    }
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
    teams: TeamAccess = this.teams,
  ): Promise<RoomRole> {
    const teamRole =
      room.teamId && userId && room.creatorId !== userId
        ? ((await teams.membershipOf(room.teamId, userId))?.role ?? null)
        : null;
    return resolveRoomRole(room.creatorId, userId, teamRole);
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
    const session = this.guests.resume(room.id, request.guestToken);

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
    reactions: Reaction[] = [],
  ): Promise<RoomState> {
    const { room, round, votes } = await this.db.transaction(
      async (tx) => {
        const repo = this.createRoomsRepository(tx);
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
      result:
        round?.status === 'revealed' ? summarizeRound(votes, round.deckType, round.average) : null,
      timer,
      reactions,
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
        return summarizeRound(votes, round.deckType, round.average);
      }

      const result = summarizeRound(votes, round.deckType);
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
    action: (repo: RoomsRepository, room: Room, teams: TeamAccess) => Promise<T>,
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
    action: (repo: RoomsRepository, room: Room, teams: TeamAccess) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const repo = this.createRoomsRepository(tx);
      const room = await repo.lockRoom(roomId);
      if (!room) {
        throw new NotFoundError('Комната не найдена');
      }
      return action(repo, room, this.createTeamAccess(tx));
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
    teams: TeamAccess,
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

  /** Идентификаторы приходят по сокету без схем — проверяем формат до похода в базу */
  private requireUuid(value: string, what: string): string {
    if (typeof value !== 'string' || !isValidUuid(value)) {
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
    const value = trimText(raw);
    if (!isTextLengthInRange(value, { min: 1, max: maxLength })) {
      throw new ValidationError(`${field}: от 1 до ${maxLength} символов`);
    }
    return value;
  }

  /** Пустая строка означает «ссылку убрали» */
  private normalizeLink(raw: string | null | undefined): string | null {
    const value = trimOptionalText(raw);
    if (!value) {
      return null;
    }
    if (value.length > ROOM_LINK_MAX_LENGTH) {
      throw new ValidationError('Ссылка слишком длинная');
    }
    if (!isHttpUrl(value)) {
      throw new ValidationError('Ссылка должна начинаться с http:// или https://');
    }
    return value;
  }
}
