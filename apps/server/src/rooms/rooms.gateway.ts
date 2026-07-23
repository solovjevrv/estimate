import {
  WS_EVENTS,
  WS_SERVER_EVENTS,
  type JoinRoomPayload,
  type JoinRoomResult,
  type StartRoundPayload,
  type SubmitVotePayload,
  type UpdateLinksPayload,
  type WsAck,
} from '@poker/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Socket } from 'socket.io';

import { AppError, ForbiddenError, ValidationError } from '../errors';
import type { PokerServer } from '../socket';

import { RoomPresence, type ParticipantIdentity } from './presence';
import type { RoomsService } from './rooms.service';

type Ack<T> = (response: WsAck<T>) => void;

/**
 * Игровые события комнаты. Права проверяются на каждом событии: клиент
 * присылает только намерение, роль и состояние берутся с сервера.
 */
export class RoomsGateway {
  constructor(
    private readonly service: RoomsService,
    private readonly presence = new RoomPresence(),
  ) {}

  register(io: PokerServer, log: FastifyBaseLogger): void {
    io.on('connection', (socket) => {
      socket.on(WS_EVENTS.JOIN_ROOM, (payload: JoinRoomPayload, ack?: Ack<JoinRoomResult>) => {
        void this.handle(socket, log, ack, () => this.join(io, socket, payload));
      });

      socket.on(WS_EVENTS.SUBMIT_VOTE, (payload: SubmitVotePayload, ack?: Ack<null>) => {
        void this.handle(socket, log, ack, async () => {
          const { roomId, identity } = this.requireSeat(socket);
          await this.service.submitVote(roomId, identity, payload?.value);
          await this.broadcastState(io, roomId);
          return null;
        });
      });

      socket.on(WS_EVENTS.REVEAL_CARDS, (ack?: Ack<null>) => {
        void this.handle(socket, log, ack, async () => {
          const { roomId, identity } = this.requireSeat(socket);
          await this.service.revealCards(roomId, identity);
          await this.broadcastState(io, roomId);
          return null;
        });
      });

      socket.on(WS_EVENTS.START_NEW_ROUND, (payload: StartRoundPayload, ack?: Ack<null>) => {
        void this.handle(socket, log, ack, async () => {
          const { roomId, identity } = this.requireSeat(socket);
          await this.service.startNewRound(roomId, identity, payload);
          await this.broadcastState(io, roomId);
          return null;
        });
      });

      socket.on(WS_EVENTS.UPDATE_LINKS, (payload: UpdateLinksPayload, ack?: Ack<null>) => {
        void this.handle(socket, log, ack, async () => {
          const { roomId } = this.requireSeat(socket);
          // Ссылки на задачу правит любой участник — так решено в Epic 5
          await this.service.updateLinks(roomId, payload ?? {});
          await this.broadcastState(io, roomId);
          return null;
        });
      });

      socket.on('disconnect', () => {
        const roomId = this.presence.leave(socket.id);
        if (roomId) {
          void this.broadcastState(io, roomId).catch((err: unknown) => {
            log.warn({ err, roomId }, 'Не удалось разослать состояние после выхода участника');
          });
        }
      });
    });
  }

  private async join(
    io: PokerServer,
    socket: Socket,
    payload: JoinRoomPayload,
  ): Promise<JoinRoomResult> {
    if (!payload?.roomId) {
      throw new ValidationError('Не указана комната');
    }

    const { identity } = await this.service.prepareJoin({
      roomId: payload.roomId,
      userId: socket.data.userId,
      guestName: payload.guestName,
      guestSessionId: payload.guestSessionId,
    });

    await socket.join(payload.roomId);
    this.presence.join(payload.roomId, socket.id, identity);

    const state = await this.service.getState(payload.roomId, this.presence.list(payload.roomId));
    // Остальным за столом сразу показываем нового участника
    socket.to(payload.roomId).emit(WS_SERVER_EVENTS.ROOM_STATE, state);

    return {
      state,
      guestSessionId: identity.isGuest ? identity.participantId : null,
      participantId: identity.participantId,
    };
  }

  /** Действовать может только тот, кто уже сидит за столом */
  private requireSeat(socket: Socket): { roomId: string; identity: ParticipantIdentity } {
    const roomId = this.presence.roomOf(socket.id);
    const identity = this.presence.identityOf(socket.id);
    if (!roomId || !identity) {
      throw new ForbiddenError('Сначала войдите в комнату');
    }
    return { roomId, identity };
  }

  private async broadcastState(io: PokerServer, roomId: string): Promise<void> {
    const state = await this.service.getState(roomId, this.presence.list(roomId));
    io.to(roomId).emit(WS_SERVER_EVENTS.ROOM_STATE, state);
  }

  /**
   * Общая обвязка обработчиков: ошибки уходят в ack тем же форматом,
   * что и в REST, а подробности остаются в логах.
   */
  private async handle<T>(
    socket: Socket,
    log: FastifyBaseLogger,
    ack: Ack<T> | undefined,
    action: () => Promise<T>,
  ): Promise<void> {
    try {
      const data = await action();
      ack?.({ ok: true, data });
    } catch (err) {
      if (err instanceof AppError) {
        log.info({ socketId: socket.id, err: err.message }, 'Событие комнаты отклонено');
        ack?.({ ok: false, error: err.code, message: err.message });
        return;
      }
      log.error({ socketId: socket.id, err }, 'Ошибка обработки события комнаты');
      ack?.({ ok: false, error: 'internal', message: 'Внутренняя ошибка сервера' });
    }
  }
}
