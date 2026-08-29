import {
  BOARD_RING_BUFFER_SIZE,
  BOARD_WS_EVENTS,
  BOARD_WS_SERVER_EVENTS,
  hasBoardAccess,
  type ApplyBoardOpsPayload,
  type ApplyBoardOpsResult,
  type BoardAwarenessPayload,
  type BoardOp,
  type BoardOpsBatch,
  type BoardPresenceEntry,
  type JoinBoardPayload,
  type JoinBoardResult,
  type WsAck,
} from '@estimate/shared';
import type { FastifyBaseLogger } from 'fastify';

import { AppError, ForbiddenError, ValidationError } from '../errors';
import { PresenceRegistry } from '../platform/realtime';
import type { PokerServer, PokerSocket } from '../socket';

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
    private readonly presence = new PresenceRegistry<BoardParticipantIdentity>(),
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
          // Rollout-совместимость (23.2): проверяем не только самого
          // отправителя, а ВСЕХ участников, сейчас подключённых к доске —
          // иначе клиент с поддержкой диаграмм мог бы создать diagram-элемент,
          // пока на той же доске сидит legacy-клиент без поддержки, и тот
          // получил бы его broadcast'ом (io.to(boardId).emit ниже шлёт всем),
          // не умея его отрендерить.
          if (
            this.opsContainDiagram(ops) &&
            this.presence.list(boardId).some((participant) => !participant.supportsDiagrams)
          ) {
            throw new ValidationError(
              'На доске есть участник со старой версией страницы — элементы диаграмм временно недоступны',
            );
          }
          const { revision, ops: committed } = await this.service.applyOps(identity, boardId, ops);
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
      supportsDiagrams: payload.supportsDiagrams,
    });

    // Rollout-совместимость (23.2) решается ДО socket.join/presence.join —
    // отклонённый (legacy) клиент не должен успеть попасть в presence и
    // рассылки, которые тут же пришлось бы откатывать. Проверяем то же
    // содержимое, которое вот-вот отдадим этому сокету: снапшот (первый вход
    // или разрыв больше буфера) либо батчи догона (реконнект в пределах
    // BOARD_RING_BUFFER_SIZE) — diagram-элемент может прийти любым из путей.
    const sinceRevision = payload.sinceRevision;
    const buffered =
      sinceRevision != null ? this.catchupSince(payload.boardId, sinceRevision) : null;
    const snapshot = buffered
      ? null
      : await this.service.getSnapshot(socket.data.userId, payload.boardId);
    const hasDiagramContent = buffered
      ? this.batchesContainDiagram(buffered.ops)
      : (snapshot?.items.some((item) => item.content.type === 'diagram') ?? false);
    if (!identity.supportsDiagrams && hasDiagramContent) {
      throw new ValidationError('На доске есть элементы новой версии — обновите страницу');
    }

    // Из прошлой доски выходим полностью, иначе сокет продолжит получать её рассылки
    const previousBoard = this.presence.scopeOf(socket.id);
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

    return {
      revision: snapshot!.board.revision,
      snapshot,
      catchup: null,
      access,
      participantId: identity.participantId,
      guestToken,
    };
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

  /**
   * Проверяет, содержит ли батч операций хотя бы одну операцию с элементом
   * типа diagram (23.2 rollout-совместимость). Используется для отклонения
   * diagram-операций от клиентов без supportsDiagrams.
   */
  private opsContainDiagram(ops: BoardOp[]): boolean {
    return ops.some((op) => {
      if (op.type === 'item.create') {
        return op.item.content.type === 'diagram';
      }
      if (op.type === 'item.patch') {
        return op.patch.content?.type === 'diagram';
      }
      return false;
    });
  }

  /**
   * Батчи догона несут уже закоммиченные операции (`BoardCommittedOp`) — у
   * item.create И item.patch там всегда полный `item` (не патч), поэтому
   * достаточно одной проверки `op.item.content.type`, в отличие от
   * `opsContainDiagram` выше, которая разбирает клиентский `BoardOp`.
   */
  private batchesContainDiagram(batches: BoardOpsBatch[]): boolean {
    return batches.some((batch) =>
      batch.ops.some(
        (op) =>
          (op.type === 'item.create' || op.type === 'item.patch') &&
          op.item.content.type === 'diagram',
      ),
    );
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
