import {
  GUEST_NAME_MAX_LENGTH,
  TIMER_DEFAULT_DURATION_SEC,
  type Participant,
  type Reaction,
  type Room,
  type RoomState,
  type RevealCardsPayload,
  type Round,
  type RoundResult,
  type RoomTimerState,
  type StartRoundPayload,
  type SubmitVotePayload,
  type UpdateLinksPayload,
} from '@estimate/shared';

import { TeamAccess } from '../access';
import { UsersRepository } from '../auth';
import type { Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { GuestSessions } from '../platform/realtime';

import type { ParticipantIdentity } from './presence';
import {
  assertVoteValue,
  normalizeRoomLink,
  normalizeRoomText,
  requireDeckType,
  requireRoomUuid,
  rethrowVoteFailure,
} from './rooms-validation';
import { RoomsRepository } from './rooms.repository';
import { RoomsTransactions } from './rooms.transactions';
import { summarizeRound } from './round-scoring';

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

/**
 * Правила стола: вход, голосование, вскрытие карт, смена раунда, ссылки на
 * задачу, снимок состояния. Всем этим пользуется WS-шлюз. CRUD и жизненный
 * цикл самой комнаты (создание, список, архивация, удаление) — в
 * `RoomsService`; обе части используют общий `RoomsTransactions` (16.5).
 */
export class RoomsGameService {
  constructor(
    private readonly repository: RoomsRepository,
    private readonly users: UsersRepository,
    private readonly guests: GuestSessions,
    private readonly transactions: RoomsTransactions,
  ) {}

  static forDatabase(db: Db, guestSecret: string): RoomsGameService {
    const teams = TeamAccess.forExecutor(db);
    return new RoomsGameService(
      new RoomsRepository(db),
      new UsersRepository(db),
      new GuestSessions(guestSecret, 'guest'),
      new RoomsTransactions(db, teams),
    );
  }

  /** Комната открыта по прямой ссылке — отдельных прав на просмотр нет */
  private async getRoom(roomId: string): Promise<Room> {
    const room = await this.repository.findRoom(roomId);
    if (!room) {
      throw new NotFoundError('Комната не найдена');
    }
    return room;
  }

  /**
   * Право исключить участника — только у скрам-мастера. Само исключение (поиск
   * сокета участника и обрыв соединения) сервису не подвластно — он ничего не
   * знает о сокетах, этим занимается шлюз.
   */
  async assertCanKick(roomId: string, identity: ParticipantIdentity): Promise<void> {
    const room = await this.getRoom(roomId);
    if ((await this.transactions.resolveRole(room, identity.userId)) !== 'scrum_master') {
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

  /** Готовит участника к посадке за стол: проверяет комнату и собирает личность */
  async prepareJoin(request: JoinRequest): Promise<JoinResult> {
    const room = await this.getRoom(requireRoomUuid(request.roomId, 'комнаты'));

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
          role: await this.transactions.resolveRole(room, user.id),
        },
      };
    }

    const name = normalizeRoomText(request.guestName ?? '', GUEST_NAME_MAX_LENGTH, 'Имя');
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
    const { room, round, votes } = await this.transactions.readSnapshot(async (repo) => {
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
    });
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

    await this.transactions.inRoom(roomId, async (repo) => {
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
      assertVoteValue(round, value);

      try {
        if (identity.isGuest) {
          await repo.upsertGuestVote(round.id, identity.participantId, identity.name, value);
        } else {
          await repo.upsertUserVote(round.id, identity.participantId, value);
        }
      } catch (err) {
        rethrowVoteFailure(err);
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
    return this.transactions.inRoom(roomId, async (repo, room, teams) => {
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
    const deckType = requireDeckType(payload?.deckType);

    return this.transactions.inRoom(roomId, async (repo, room, teams) => {
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
    if (links.jiraUrl !== undefined) patch.jiraUrl = normalizeRoomLink(links.jiraUrl);
    if (links.confluenceUrl !== undefined) {
      patch.confluenceUrl = normalizeRoomLink(links.confluenceUrl);
    }

    return this.transactions.inRoom(roomId, async (repo, room) => {
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
   * Роль перечитывается на каждом действии: за время сессии владение командой
   * могли передать, а слепок с момента входа об этом не знает.
   */
  private async assertScrumMaster(
    room: Room,
    identity: ParticipantIdentity,
    message: string,
    teams: TeamAccess,
  ): Promise<void> {
    if ((await this.transactions.resolveRole(room, identity.userId, teams)) !== 'scrum_master') {
      throw new ForbiddenError(message);
    }
  }
}
