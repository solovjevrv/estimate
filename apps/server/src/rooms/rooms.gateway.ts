import {
  WS_EVENTS,
  WS_SERVER_EVENTS,
  type JoinRoomPayload,
  type JoinRoomResult,
  type RevealCardsPayload,
  type Round,
  type RoundResult,
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

/** Клиент может прислать что угодно: и без подтверждения, и вместо полезной нагрузки */
interface EventArgs<P> {
  payload: P | undefined;
  ack: Ack<unknown>;
}

const NO_OP_ACK: Ack<unknown> = () => {};

/**
 * Игровые события комнаты. Права проверяются на каждом событии: клиент
 * присылает только намерение, роль и состояние берутся с сервера.
 */
export class RoomsGateway {
  /** Незавершённые рассылки по комнатам: по одной очереди на комнату */
  private readonly broadcasts = new Map<string, Promise<void>>();

  constructor(
    private readonly service: RoomsService,
    private readonly presence = new RoomPresence(),
  ) {}

  register(io: PokerServer, log: FastifyBaseLogger): void {
    io.on('connection', (socket) => {
      socket.on(WS_EVENTS.JOIN_ROOM, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<JoinRoomPayload>(args);
        this.run(socket, log, ack, () => this.join(socket, payload));
      });

      socket.on(WS_EVENTS.SUBMIT_VOTE, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<SubmitVotePayload>(args);
        this.run(socket, log, ack, async () => {
          const { roomId, identity } = this.requireSeat(socket);
          await this.service.submitVote(roomId, identity, payload ?? ({} as SubmitVotePayload));
          await this.broadcastState(io, roomId);
          return null;
        });
      });

      socket.on(WS_EVENTS.REVEAL_CARDS, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<RevealCardsPayload>(args);
        this.run<RoundResult>(socket, log, ack, async () => {
          const { roomId, identity } = this.requireSeat(socket);
          const result = await this.service.revealCards(roomId, identity, payload ?? {});
          await this.broadcastState(io, roomId);
          return result;
        });
      });

      socket.on(WS_EVENTS.START_NEW_ROUND, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<StartRoundPayload>(args);
        this.run<Round>(socket, log, ack, async () => {
          const { roomId, identity } = this.requireSeat(socket);
          // Возвращаем раунд: если стол уже ушёл вперёд, это будет текущий, а не новый
          const round = await this.service.startNewRound(
            roomId,
            identity,
            payload as StartRoundPayload,
          );
          await this.broadcastState(io, roomId);
          return round;
        });
      });

      socket.on(WS_EVENTS.UPDATE_LINKS, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<UpdateLinksPayload>(args);
        this.run(socket, log, ack, async () => {
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
          this.broadcastState(io, roomId).catch((err: unknown) => {
            log.warn({ err, roomId }, 'Не удалось разослать состояние после выхода участника');
          });
        }
      });
    });
  }

  private async join(
    socket: Socket,
    payload: JoinRoomPayload | undefined,
  ): Promise<JoinRoomResult> {
    if (!payload?.roomId) {
      throw new ValidationError('Не указана комната');
    }

    const { identity, guestToken } = await this.service.prepareJoin({
      roomId: payload.roomId,
      userId: socket.data.userId,
      guestName: payload.guestName,
      guestToken: payload.guestToken,
    });

    // Из прошлой комнаты выходим полностью, иначе сокет продолжит получать её рассылки
    const previousRoom = this.presence.roomOf(socket.id);
    if (previousRoom && previousRoom !== payload.roomId) {
      await socket.leave(previousRoom);
    }

    await socket.join(payload.roomId);
    this.presence.join(payload.roomId, socket.id, identity);

    if (previousRoom && previousRoom !== payload.roomId) {
      await this.broadcastState(socket.nsp as unknown as PokerServer, previousRoom);
    }

    const state = await this.service.getState(payload.roomId, this.presence.list(payload.roomId));
    // Остальным за столом сразу показываем нового участника
    socket.to(payload.roomId).emit(WS_SERVER_EVENTS.ROOM_STATE, state);

    return { state, guestToken, participantId: identity.participantId };
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

  /**
   * Рассылки одной комнаты идут строго друг за другом. Иначе два снимка,
   * собранные одновременно, могут уйти в обратном порядке — и ушедший участник
   * останется на экране до следующего действия за столом.
   */
  private async broadcastState(io: PokerServer, roomId: string): Promise<void> {
    const previous = this.broadcasts.get(roomId) ?? Promise.resolve();
    const send = previous.then(async () => {
      const state = await this.service.getState(roomId, this.presence.list(roomId));
      io.to(roomId).emit(WS_SERVER_EVENTS.ROOM_STATE, state);
    });
    // В очереди ждёт завершение рассылки: сбой одной не должен обрывать следующие
    const tail = send.catch(() => {});
    this.broadcasts.set(roomId, tail);

    try {
      await send;
    } finally {
      // Очередь опустела — убираем за собой, чтобы карта не росла с числом комнат
      if (this.broadcasts.get(roomId) === tail) {
        this.broadcasts.delete(roomId);
      }
    }
  }

  /** Подтверждение и полезная нагрузка могут прийти в любом сочетании — разбираем аккуратно */
  private readArgs<P>(args: unknown[]): EventArgs<P> {
    const ack = args.find((arg): arg is Ack<unknown> => typeof arg === 'function') ?? NO_OP_ACK;
    const payload = args.find((arg) => typeof arg === 'object' && arg !== null) as P | undefined;
    return { payload, ack };
  }

  /**
   * Обработчик события: ошибки уходят в подтверждение тем же форматом, что и в
   * REST, подробности остаются в логах. Ни один отказ не должен всплыть наружу —
   * необработанный отказ уронил бы процесс вместе со всеми комнатами.
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
          log.info({ socketId: socket.id, err: err.message }, 'Событие комнаты отклонено');
          this.reply(log, ack, { ok: false, error: err.code, message: err.message });
          return;
        }
        log.error({ socketId: socket.id, err }, 'Ошибка обработки события комнаты');
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
      log.warn({ err }, 'Не удалось отправить подтверждение события');
    }
  }
}
