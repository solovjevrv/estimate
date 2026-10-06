import {
  BOARD_RING_BUFFER_SIZE,
  BOARD_TIMER_DEFAULT_DURATION_SEC,
  BOARD_TIMER_EXTEND_SEC,
  BOARD_TIMER_MAX_DURATION_SEC,
  BOARD_WS_EVENTS,
  BOARD_WS_SERVER_EVENTS,
  hasBoardAccess,
  isValidBoardTimerDuration,
  type ApplyBoardOpsPayload,
  type ApplyBoardOpsResult,
  type BoardAwarenessPayload,
  type BoardOpsBatch,
  type BoardPresenceEntry,
  type BoardTimerState,
  type BoardVotePayload,
  type BoardVotingRefPayload,
  type BoardVotingState,
  type BoardVotingSummary,
  type JoinBoardPayload,
  type JoinBoardResult,
  type ResetBoardTimerPayload,
  type StartBoardVotingPayload,
  type WsAck,
} from '@estimate/shared';
import type { FastifyBaseLogger } from 'fastify';

import { AppError, ConflictError, ForbiddenError, ValidationError } from '../errors';
import { CountdownTimer, PresenceRegistry } from '../platform/realtime';
import type { PokerServer, PokerSocket } from '../socket';

import { votingStateFor } from './board-voting-state';
import type { BoardVotingService } from './board-voting.service';
import type { BoardParticipantIdentity } from './presence';
import type { BoardsService } from './boards.service';

type Ack<T> = (response: WsAck<T>) => void;

interface EventArgs<P> {
  payload: P | undefined;
  ack: Ack<unknown>;
}

const NO_OP_ACK: Ack<unknown> = () => {};

/**
 * Реалтайм-канал досок (12.4). У мутирующих событий (`JOIN`, `APPLY`) права
 * проверяются по живому состоянию сервера — так же, как у `RoomsGateway`:
 * клиент присылает только намерение, доступ и роль пересчитываются заново из
 * БД. У эфемерного `AWARENESS` (14.7) — доступ, посчитанный на момент `JOIN`
 * (тоже живая проверка, но не на каждое отдельное событие): курсор не
 * чувствительные данные, а частый троттлед канал не стоит нагружать запросом
 * в БД на каждое движение мыши.
 */
export class BoardsGateway {
  /** Последние батчи операций на доску — используются для догона по `sinceRevision` */
  private readonly ringBuffers = new Map<string, BoardOpsBatch[]>();

  constructor(
    private readonly service: BoardsService,
    /** Голосование точками (15.2); не задано — события голосования отклоняются */
    private readonly voting?: BoardVotingService,
    private readonly presence = new PresenceRegistry<BoardParticipantIdentity>(),
    /** Таймер доски (15.3) — сиюминутное состояние, как присутствие */
    private readonly timer = new CountdownTimer({
      defaultDurationSec: BOARD_TIMER_DEFAULT_DURATION_SEC,
      isValidDuration: isValidBoardTimerDuration,
      maxRemainingSec: BOARD_TIMER_MAX_DURATION_SEC,
    }),
  ) {}

  register(io: PokerServer, log: FastifyBaseLogger): void {
    io.on('connection', (socket) => {
      socket.on(BOARD_WS_EVENTS.JOIN, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<JoinBoardPayload>(args);
        this.run(socket, log, ack, () => this.join(io, socket, payload));
      });

      socket.on(BOARD_WS_EVENTS.APPLY, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<ApplyBoardOpsPayload>(args);
        this.run<ApplyBoardOpsResult>(socket, log, ack, async () => {
          const { boardId, identity } = this.requireSeat(socket);
          const ops = payload?.ops;
          if (!ops || ops.length === 0) {
            throw new ValidationError('Пустой список операций');
          }
          const { revision, ops: committed } = await this.service.applyOps(identity, boardId, ops);
          const batch: BoardOpsBatch = { revision, ops: committed };
          this.pushToBuffer(boardId, batch);
          // Рассылаем всем, включая отправителя — своя же операция отбрасывается
          // на клиенте по `clientOpId`, а не особым обхождением на сервере
          io.to(boardId).emit(BOARD_WS_SERVER_EVENTS.OPS, batch);
          // Удалённый элемент уносит свои голоса из итогов, восстановленный
          // (undo) — возвращает: снимок голосования у всех устарел
          const touched = committed.flatMap((op) =>
            op.type === 'item.delete' ? [op.id] : op.type === 'item.create' ? [op.item.id] : [],
          );
          if (touched.length > 0 && this.voting) {
            const voting = this.voting;
            void voting
              .affectsVotes(boardId, touched)
              .then((affected) => (affected ? this.broadcastVoting(io, boardId) : undefined))
              .catch((err: unknown) => {
                log.warn({ err, boardId }, 'Не удалось разослать голосование после правки');
              });
          }
          return { revision };
        });
      });

      socket.on(BOARD_WS_EVENTS.AWARENESS, (...args: unknown[]) => {
        const { payload } = this.readArgs<BoardAwarenessPayload>(args);
        // Эфемерное событие без подтверждения: не авторизован — просто игнорируем,
        // отвечать клиенту нечем и незачем
        const boardId = this.presence.scopeOf(socket.id);
        const identity = this.presence.identityOf(socket.id);
        if (!boardId || !identity || !payload) {
          return;
        }
        // Клиент сам не шлёт курсор без canEdit (BoardCanvas.vue), но модифицированный
        // клиент технически мог бы — доступ, посчитанный на JOIN, здесь тоже
        // обязателен (14.7). Не полный live-recheck на каждое событие (как у APPLY):
        // курсор не чувствительные данные, а частый троттлед канал не стоит нагружать
        // запросом в БД на каждое движение мыши — доступ пересчитывается заново при
        // каждом (пере)подключении к доске.
        if (!hasBoardAccess(identity.access, 'edit')) {
          return;
        }
        // socket.to() (в отличие от io.to()) не шлёт самому отправителю — курсор
        // не нужно эхом возвращать себе же
        socket.volatile.to(boardId).emit(BOARD_WS_SERVER_EVENTS.AWARENESS, {
          participantId: identity.participantId,
          userId: identity.userId,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
          isGuest: identity.isGuest,
          kind: payload.kind,
          data: payload.data,
        });
      });

      socket.on(BOARD_WS_EVENTS.TIMER_START, (...args: unknown[]) => {
        const { ack } = this.readArgs(args);
        this.runTimer(io, socket, log, ack, (boardId) => this.timer.start(boardId));
      });

      socket.on(BOARD_WS_EVENTS.TIMER_PAUSE, (...args: unknown[]) => {
        const { ack } = this.readArgs(args);
        this.runTimer(io, socket, log, ack, (boardId) => this.timer.pause(boardId));
      });

      socket.on(BOARD_WS_EVENTS.TIMER_RESET, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<ResetBoardTimerPayload>(args);
        this.runTimer(io, socket, log, ack, (boardId) =>
          this.timer.reset(boardId, payload?.durationSec),
        );
      });

      socket.on(BOARD_WS_EVENTS.TIMER_EXTEND, (...args: unknown[]) => {
        const { ack } = this.readArgs(args);
        this.runTimer(io, socket, log, ack, (boardId) =>
          this.timer.extend(boardId, BOARD_TIMER_EXTEND_SEC),
        );
      });

      socket.on(BOARD_WS_EVENTS.VOTING_START, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<StartBoardVotingPayload>(args);
        this.runVoting(io, socket, log, ack, async (voting, identity, boardId) => {
          await voting.start(identity, boardId, payload);
          // Таймер вместе с голосованием — всегда заново, в т.ч. после истёкшего
          if (payload?.startTimer === true) {
            this.timer.reset(boardId);
            this.emitTimer(io, boardId, this.timer.start(boardId));
          }
        });
      });

      socket.on(BOARD_WS_EVENTS.VOTING_VOTE, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<BoardVotePayload>(args);
        this.runVoting(io, socket, log, ack, (voting, identity, boardId) =>
          voting.vote(identity, boardId, payload),
        );
      });

      socket.on(BOARD_WS_EVENTS.VOTING_CLOSE, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<BoardVotingRefPayload>(args);
        this.runVoting(io, socket, log, ack, async (voting, identity, boardId) => {
          const { withTimer } = await voting.close(identity, boardId, payload?.votingId);
          if (withTimer) this.emitTimer(io, boardId, this.timer.reset(boardId));
        });
      });

      socket.on(BOARD_WS_EVENTS.VOTING_CANCEL, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<BoardVotingRefPayload>(args);
        this.runVoting(io, socket, log, ack, async (voting, identity, boardId) => {
          const { withTimer } = await voting.cancel(identity, boardId, payload?.votingId);
          if (withTimer) this.emitTimer(io, boardId, this.timer.reset(boardId));
        });
      });

      socket.on(BOARD_WS_EVENTS.VOTING_DELETE, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<BoardVotingRefPayload>(args);
        this.runVoting(io, socket, log, ack, (voting, identity, boardId) =>
          voting.delete(identity, boardId, payload?.votingId),
        );
      });

      socket.on(BOARD_WS_EVENTS.VOTING_HISTORY, (...args: unknown[]) => {
        const { ack } = this.readArgs(args);
        this.run<BoardVotingSummary[]>(socket, log, ack, async () => {
          const { boardId, identity } = this.requireSeat(socket);
          return this.requireVoting().history(identity, boardId);
        });
      });

      socket.on(BOARD_WS_EVENTS.VOTING_RESULTS, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<BoardVotingRefPayload>(args);
        this.run<BoardVotingState>(socket, log, ack, async () => {
          const { boardId, identity } = this.requireSeat(socket);
          return this.requireVoting().results(identity, boardId, payload?.votingId);
        });
      });

      socket.on('disconnect', () => {
        const boardId = this.presence.leave(socket.id);
        if (boardId) {
          if (this.presence.list(boardId).length === 0) {
            this.forgetEmptyBoard(boardId);
          }
          this.broadcastPresence(io, boardId);
        }
      });
    });
  }

  private async join(
    io: PokerServer,
    socket: PokerSocket,
    payload: JoinBoardPayload | undefined,
  ): Promise<JoinBoardResult> {
    if (!payload?.boardId) {
      throw new ValidationError('Не указана доска');
    }

    const { access, identity, guestToken } = await this.service.prepareBoardJoin({
      boardId: payload.boardId,
      userId: socket.data.userId,
      guestName: payload.guestName,
      guestToken: payload.guestToken,
    });

    // Из прошлой доски выходим полностью, иначе сокет продолжит получать её рассылки
    const previousBoard = this.presence.scopeOf(socket.id);
    if (previousBoard && previousBoard !== payload.boardId) {
      await socket.leave(previousBoard);
    }

    await socket.join(payload.boardId);
    this.presence.join(payload.boardId, socket.id, identity);

    if (previousBoard && previousBoard !== payload.boardId) {
      if (this.presence.list(previousBoard).length === 0) {
        this.forgetEmptyBoard(previousBoard);
      }
      this.broadcastPresence(io, previousBoard);
    }
    this.broadcastPresence(io, payload.boardId);

    const votingSnapshot = await this.voting?.loadSnapshot(payload.boardId);
    const voting = votingSnapshot ? votingStateFor(votingSnapshot, identity.participantId) : null;

    const sinceRevision = payload.sinceRevision;
    const buffered =
      sinceRevision != null ? this.catchupSince(payload.boardId, sinceRevision) : null;
    if (buffered) {
      return {
        revision: buffered.revision,
        snapshot: null,
        catchup: buffered.ops,
        access,
        participantId: identity.participantId,
        guestToken,
        timer: this.timer.get(payload.boardId),
        voting,
      };
    }

    const snapshot = await this.service.getSnapshot(socket.data.userId, payload.boardId);
    return {
      revision: snapshot.board.revision,
      snapshot,
      catchup: null,
      access,
      participantId: identity.participantId,
      guestToken,
      timer: this.timer.get(payload.boardId),
      voting,
    };
  }

  /**
   * Действие с голосованием. Подтверждение — без данных: новое состояние у
   * каждого своё (до завершения чужие голоса скрыты), поэтому оно приходит
   * персональной рассылкой `board:voting` всем на доске, включая отправителя.
   */
  private runVoting(
    io: PokerServer,
    socket: PokerSocket,
    log: FastifyBaseLogger,
    ack: Ack<unknown>,
    action: (
      voting: BoardVotingService,
      identity: BoardParticipantIdentity,
      boardId: string,
    ) => Promise<void>,
  ): void {
    this.run<null>(socket, log, ack, async () => {
      const { boardId, identity } = this.requireSeat(socket);
      await action(this.requireVoting(), identity, boardId);
      await this.broadcastVoting(io, boardId);
      return null;
    });
  }

  private requireVoting(): BoardVotingService {
    if (!this.voting) throw new ConflictError('Голосование недоступно');
    return this.voting;
  }

  private emitTimer(io: PokerServer, boardId: string, state: BoardTimerState): void {
    io.to(boardId).emit(BOARD_WS_SERVER_EVENTS.TIMER, state);
  }

  /** Каждому участнику доски — его собственный снимок голосования */
  private async broadcastVoting(io: PokerServer, boardId: string): Promise<void> {
    if (!this.voting) return;
    const snapshot = await this.voting.loadSnapshot(boardId);
    for (const { participantId } of this.presence.list(boardId)) {
      const state = snapshot ? votingStateFor(snapshot, participantId) : null;
      for (const socketId of this.presence.socketIdsOf(boardId, participantId)) {
        io.to(socketId).emit(BOARD_WS_SERVER_EVENTS.VOTING, state);
      }
    }
  }

  /**
   * Команда таймеру: право проверяется по живому состоянию БД (как у `APPLY`,
   * а не по доступу с момента `JOIN`) — ссылку на редактирование могли отозвать.
   * Новое состояние уходит всем на доске, включая отправителя, и в ack.
   */
  private runTimer(
    io: PokerServer,
    socket: PokerSocket,
    log: FastifyBaseLogger,
    ack: Ack<unknown>,
    command: (boardId: string) => BoardTimerState,
  ): void {
    this.run<BoardTimerState>(socket, log, ack, async () => {
      const { boardId, identity } = this.requireSeat(socket);
      await this.service.assertActiveEditAccess(identity.userId, boardId);
      const state = command(boardId);
      this.emitTimer(io, boardId, state);
      return state;
    });
  }

  /** Доска опустела — кольцевому буферу и таймеру дальше жить незачем */
  private forgetEmptyBoard(boardId: string): void {
    this.ringBuffers.delete(boardId);
    this.timer.clear(boardId);
  }

  /** Действовать может только тот, кто уже вошёл на доску */
  private requireSeat(socket: PokerSocket): {
    boardId: string;
    identity: BoardParticipantIdentity;
  } {
    const boardId = this.presence.scopeOf(socket.id);
    const identity = this.presence.identityOf(socket.id);
    if (!boardId || !identity) {
      throw new ForbiddenError('Сначала войдите на доску');
    }
    return { boardId, identity };
  }

  private pushToBuffer(boardId: string, batch: BoardOpsBatch): void {
    const buffer = this.ringBuffers.get(boardId) ?? [];
    buffer.push(batch);
    if (buffer.length > BOARD_RING_BUFFER_SIZE) {
      buffer.shift();
    }
    this.ringBuffers.set(boardId, buffer);
  }

  /**
   * Батчи строго после `sinceRevision` — либо `null`, если буфер не может
   * закрыть разрыв (пуст, доска не имела операций с момента входа этого
   * процесса, или клиент отстал дальше, чем буфер помнит). В этом случае
   * вызывающий код откатывается на полный снимок.
   */
  private catchupSince(
    boardId: string,
    sinceRevision: number,
  ): { ops: BoardOpsBatch[]; revision: number } | null {
    const buffer = this.ringBuffers.get(boardId);
    if (!buffer || buffer.length === 0) {
      return null;
    }
    const earliest = buffer[0]!.revision;
    // Буфер хранит батчи с ревизиями earliest..latest. Чтобы закрыть разрыв без
    // потерь, клиент не должен был пропустить ничего раньше самого старого батча
    if (sinceRevision < earliest - 1) {
      return null;
    }
    const tail = buffer.filter((batch) => batch.revision > sinceRevision);
    const revision = buffer[buffer.length - 1]!.revision;
    return { ops: tail, revision };
  }

  private broadcastPresence(io: PokerServer, boardId: string): void {
    const entries: BoardPresenceEntry[] = this.presence
      .list(boardId)
      .map(({ participantId, userId, name, avatarUrl, isGuest }) => ({
        participantId,
        userId,
        name,
        avatarUrl,
        isGuest,
      }));
    io.to(boardId).emit(BOARD_WS_SERVER_EVENTS.PRESENCE, entries);
  }

  /** Подтверждение и полезная нагрузка могут прийти в любом сочетании — разбираем аккуратно */
  private readArgs<P>(args: unknown[]): EventArgs<P> {
    const ack = args.find((arg): arg is Ack<unknown> => typeof arg === 'function') ?? NO_OP_ACK;
    const payload = args.find(
      (arg) => typeof arg === 'object' && arg !== null && !Array.isArray(arg),
    ) as P | undefined;
    return { payload, ack };
  }

  /**
   * Обработчик события: ошибки уходят в подтверждение тем же форматом, что и в
   * REST, подробности остаются в логах. Ни один отказ не должен всплыть наружу —
   * необработанный отказ уронил бы процесс вместе со всеми досками.
   */
  private run<T>(
    socket: PokerSocket,
    log: FastifyBaseLogger,
    ack: Ack<unknown>,
    action: () => Promise<T>,
  ): void {
    void action().then(
      (data) => this.reply(log, ack, { ok: true, data }),
      (err: unknown) => {
        if (err instanceof AppError) {
          log.info({ socketId: socket.id, err: err.message }, 'Событие доски отклонено');
          this.reply(log, ack, { ok: false, error: err.code, message: err.message });
          return;
        }
        log.error({ socketId: socket.id, err }, 'Ошибка обработки события доски');
        this.reply(log, ack, {
          ok: false,
          error: 'internal',
          message: 'Внутренняя ошибка сервера',
        });
      },
    );
  }

  /** Подтверждение присылает клиент, поэтому его вызов тоже может бросить */
  private reply(log: FastifyBaseLogger, ack: Ack<unknown>, response: WsAck<unknown>): void {
    try {
      ack(response);
    } catch (err) {
      log.warn({ err }, 'Не удалось отправить подтверждение события доски');
    }
  }
}
