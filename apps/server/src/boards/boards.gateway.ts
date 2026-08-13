import {
  BOARD_RING_BUFFER_SIZE,
  BOARD_WS_EVENTS,
  BOARD_WS_SERVER_EVENTS,
  type ApplyBoardOpsPayload,
  type ApplyBoardOpsResult,
  type BoardAwarenessPayload,
  type BoardOpsBatch,
  type BoardPresenceEntry,
  type JoinBoardPayload,
  type JoinBoardResult,
  type WsAck,
} from '@poker/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Socket } from 'socket.io';

import { AppError, ForbiddenError, ValidationError } from '../errors';
import type { PokerServer } from '../socket';

import { BoardPresence, type BoardParticipantIdentity } from './presence';
import type { BoardsService } from './boards.service';

type Ack<T> = (response: WsAck<T>) => void;

interface EventArgs<P> {
  payload: P | undefined;
  ack: Ack<unknown>;
}

const NO_OP_ACK: Ack<unknown> = () => {};

/**
 * Реалтайм-канал досок (12.4). Права проверяются на каждом событии по живому
 * состоянию сервера — так же, как у `RoomsGateway`: клиент присылает только
 * намерение, доступ и роль пересчитываются заново.
 */
export class BoardsGateway {
  /** Последние батчи операций на доску — используются для догона по `sinceRevision` */
  private readonly ringBuffers = new Map<string, BoardOpsBatch[]>();

  constructor(
    private readonly service: BoardsService,
    private readonly presence = new BoardPresence(),
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
          const { revision, ops: committed } = await this.service.applyOps(
            identity,
            boardId,
            ops,
          );
          const batch: BoardOpsBatch = { revision, ops: committed };
          this.pushToBuffer(boardId, batch);
          // Рассылаем всем, включая отправителя — своя же операция отбрасывается
          // на клиенте по `clientOpId`, а не особым обхождением на сервере
          io.to(boardId).emit(BOARD_WS_SERVER_EVENTS.OPS, batch);
          return { revision };
        });
      });

      socket.on(BOARD_WS_EVENTS.AWARENESS, (...args: unknown[]) => {
        const { payload } = this.readArgs<BoardAwarenessPayload>(args);
        // Эфемерное событие без подтверждения: не авторизован — просто игнорируем,
        // отвечать клиенту нечем и незачем
        const boardId = this.presence.boardOf(socket.id);
        const identity = this.presence.identityOf(socket.id);
        if (!boardId || !identity || !payload) {
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

      socket.on('disconnect', () => {
        const boardId = this.presence.leave(socket.id);
        if (boardId) {
          if (this.presence.list(boardId).length === 0) {
            // Доска опустела — кольцевому буферу дальше жить незачем
            this.ringBuffers.delete(boardId);
          }
          this.broadcastPresence(io, boardId);
        }
      });
    });
  }

  private async join(
    io: PokerServer,
    socket: Socket,
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
    const previousBoard = this.presence.boardOf(socket.id);
    if (previousBoard && previousBoard !== payload.boardId) {
      await socket.leave(previousBoard);
    }

    await socket.join(payload.boardId);
    this.presence.join(payload.boardId, socket.id, identity);

    if (previousBoard && previousBoard !== payload.boardId) {
      if (this.presence.list(previousBoard).length === 0) {
        this.ringBuffers.delete(previousBoard);
      }
      this.broadcastPresence(io, previousBoard);
    }
    this.broadcastPresence(io, payload.boardId);

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
    };
  }

  /** Действовать может только тот, кто уже вошёл на доску */
  private requireSeat(socket: Socket): { boardId: string; identity: BoardParticipantIdentity } {
    const boardId = this.presence.boardOf(socket.id);
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
    socket: Socket,
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
