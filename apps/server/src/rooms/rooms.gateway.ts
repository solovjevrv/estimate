import {
  REACTION_EMOJIS,
  WS_EVENTS,
  WS_SERVER_EVENTS,
  type JoinRoomPayload,
  type JoinRoomResult,
  type KickParticipantPayload,
  type ResetTimerPayload,
  type RoomState,
  type RoomTimerState,
  type RevealCardsPayload,
  type Round,
  type RoundResult,
  type SendReactionPayload,
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
import { RoomReactions } from './room-reactions';
import { RoomTimer } from './room-timer';
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
    private readonly timer = new RoomTimer(),
    private readonly reactions = new RoomReactions(),
  ) {}

  register(io: PokerServer, log: FastifyBaseLogger): void {
    io.on('connection', (socket) => {
      socket.on(WS_EVENTS.JOIN_ROOM, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<JoinRoomPayload>(args);
        this.run(socket, log, ack, () => this.join(io, socket, payload));
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
          // Новая задача — таймер обсуждения и реакции на прошлой ей не нужны
          this.timer.reset(roomId);
          this.reactions.clear(roomId);
          await this.broadcastState(io, roomId);
          return round;
        });
      });

      socket.on(WS_EVENTS.START_TIMER, (...args: unknown[]) => {
        const { ack } = this.readArgs<undefined>(args);
        this.run<RoomTimerState>(socket, log, ack, async () => {
          const { roomId } = this.requireSeat(socket);
          await this.service.assertRoomOpen(roomId);
          const state = this.timer.start(roomId);
          await this.broadcastState(io, roomId);
          return state;
        });
      });

      socket.on(WS_EVENTS.PAUSE_TIMER, (...args: unknown[]) => {
        const { ack } = this.readArgs<undefined>(args);
        this.run<RoomTimerState>(socket, log, ack, async () => {
          const { roomId } = this.requireSeat(socket);
          await this.service.assertRoomOpen(roomId);
          const state = this.timer.pause(roomId);
          await this.broadcastState(io, roomId);
          return state;
        });
      });

      socket.on(WS_EVENTS.RESET_TIMER, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<ResetTimerPayload>(args);
        this.run<RoomTimerState>(socket, log, ack, async () => {
          const { roomId } = this.requireSeat(socket);
          await this.service.assertRoomOpen(roomId);
          const state = this.timer.reset(roomId, payload?.durationSec);
          await this.broadcastState(io, roomId);
          return state;
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

      socket.on(WS_EVENTS.KICK_PARTICIPANT, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<KickParticipantPayload>(args);
        this.run(socket, log, ack, async () => {
          const { roomId, identity } = this.requireSeat(socket);
          const targetId = payload?.participantId;
          if (!targetId) {
            throw new ValidationError('Не указан участник');
          }
          if (targetId === identity.participantId) {
            throw new ForbiddenError('Нельзя исключить самого себя');
          }
          await this.service.assertCanKick(roomId, identity);

          // Кикнуть нужно все вкладки того же человека, а не одну — иначе
          // призрак останется висеть под второй сессией
          for (const targetSocketId of this.presence.socketIdsOf(roomId, targetId)) {
            // Адресное событие — прежде чем рвать соединение, иначе клиент не
            // отличит кик от разрыва по протухшему токену (7.7) и тихо
            // переподключится тем же обработчиком. У каждого сокета своя
            // приватная комната с именем-id (заводится Socket.IO сама) — так
            // рассылка попадает ровно в него, без хранения самого объекта Socket.
            io.to(targetSocketId).emit(WS_SERVER_EVENTS.KICKED, {});
            io.sockets.sockets.get(targetSocketId)?.disconnect(true);
          }
          return null;
        });
      });

      socket.on(WS_EVENTS.SEND_REACTION, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<SendReactionPayload>(args);
        this.run(socket, log, ack, async () => {
          const { roomId, identity } = this.requireSeat(socket);
          const targetId = payload?.targetParticipantId;
          if (!targetId) {
            throw new ValidationError('Не указан участник');
          }
          if (targetId === identity.participantId) {
            throw new ForbiddenError('Нельзя отправить реакцию самому себе');
          }
          const emoji = payload?.emoji;
          if (!emoji || !(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
            throw new ValidationError('Недопустимый эмодзи');
          }
          // Адресат должен реально сидеть за столом — иначе реакции на случайные
          // id копились бы в памяти комнаты без ограничения и без возможности очистки
          const targetSeated = this.presence.list(roomId).some((p) => p.participantId === targetId);
          if (!targetSeated) {
            throw new ValidationError('Участник не найден в комнате');
          }
          this.reactions.toggle(roomId, identity.participantId, targetId, emoji);
          await this.broadcastState(io, roomId);
          return null;
        });
      });

      socket.on('disconnect', () => {
        const roomId = this.presence.leave(socket.id);
        if (roomId) {
          // Стол опустел — сиюминутному состоянию таймера и реакций дальше жить незачем
          if (this.presence.list(roomId).length === 0) {
            this.timer.clear(roomId);
            this.reactions.clear(roomId);
          }
          this.broadcastState(io, roomId).catch((err: unknown) => {
            log.warn({ err, roomId }, 'Не удалось разослать состояние после выхода участника');
          });
        }
      });
    });
  }

  private async join(
    io: PokerServer,
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
      // Прошлая комната опустела — сиюминутному состоянию таймера и реакций дальше жить незачем
      // (как и при disconnect ниже: без этого запись в RoomTimer осталась бы навсегда)
      if (this.presence.list(previousRoom).length === 0) {
        this.timer.clear(previousRoom);
        this.reactions.clear(previousRoom);
      }
      await this.broadcastState(io, previousRoom);
    }

    // Нового участника показываем всем той же рассылкой, что и остальные события:
    // отдельный снимок мимо очереди мог бы уйти после более свежего
    const state = await this.broadcastState(io, payload.roomId);

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
  private async broadcastState(io: PokerServer, roomId: string): Promise<RoomState> {
    const previous = this.broadcasts.get(roomId) ?? Promise.resolve();
    const send = previous.then(async () => {
      const state = await this.service.getState(
        roomId,
        this.presence.list(roomId),
        this.timer.get(roomId),
        this.reactions.list(roomId),
      );
      io.to(roomId).emit(WS_SERVER_EVENTS.ROOM_STATE, state);
      return state;
    });
    // В очереди ждёт завершение рассылки: сбой одной не должен обрывать следующие
    const tail = send.then(
      () => {},
      () => {},
    );
    this.broadcasts.set(roomId, tail);

    try {
      return await send;
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
