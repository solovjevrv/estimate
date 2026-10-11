import {
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
  type WsAck,
} from '@estimate/shared';
import { isValidEmojiSequence } from '@estimate/shared/emoji/validate';
import type { FastifyBaseLogger } from 'fastify';

import { AppError, ForbiddenError, ValidationError } from '../errors';
import { ClusterPresence, MemoryRealtimeStore, type RealtimeStore } from '../platform/realtime';
import type { PokerServer, PokerSocket, SocketData } from '../socket';

import type { ParticipantIdentity } from './presence';
import { RoomReactions } from './room-reactions';
import { RoomTimer } from './room-timer';
import type { RoomsGameService } from './rooms.game.service';

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
/** Итог раунда мог измениться (вскрытие, переголосование) — для оценки на доске (15.6) */
export type RoomResultListener = (io: PokerServer, roomId: string) => Promise<void>;

export class RoomsGateway {
  private resultListener: RoomResultListener | undefined;

  onRoundResult(listener: RoomResultListener | undefined): this {
    this.resultListener = listener;
    return this;
  }

  /** Не блокирует ответ комнате: доска узнает об оценке чуть позже, ошибка — только в лог */
  private notifyResult(io: PokerServer, roomId: string, log: FastifyBaseLogger): void {
    void this.resultListener?.(io, roomId).catch((err: unknown) => {
      log.warn({ err, roomId }, 'Не удалось разослать оценку на доску');
    });
  }

  private readonly presence = new ClusterPresence<ParticipantIdentity, SocketData>({
    read: (data) => data.room,
    write: (data, seat) => {
      data.room = seat;
    },
  });
  private readonly timer: RoomTimer;
  private readonly reactions: RoomReactions;

  /**
   * `store` — общее сиюминутное состояние (10.18): в памяти процесса для одного
   * экземпляра или в Redis — для нескольких
   */
  constructor(
    private readonly service: RoomsGameService,
    private readonly store: RealtimeStore = new MemoryRealtimeStore(),
  ) {
    this.timer = new RoomTimer(store);
    this.reactions = new RoomReactions(store);
  }

  register(io: PokerServer, log: FastifyBaseLogger): void {
    this.presence.onPartial = (err) => {
      log.warn({ err }, 'Комната: соседний экземпляр не ответил — присутствие только со своего');
    };
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
          this.notifyResult(io, roomId, log);
          return null;
        });
      });

      socket.on(WS_EVENTS.REVEAL_CARDS, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<RevealCardsPayload>(args);
        this.run<RoundResult>(socket, log, ack, async () => {
          const { roomId, identity } = this.requireSeat(socket);
          const result = await this.service.revealCards(roomId, identity, payload ?? {});
          await this.broadcastState(io, roomId);
          this.notifyResult(io, roomId, log);
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
          await this.timer.reset(roomId);
          await this.reactions.clear(roomId);
          await this.broadcastState(io, roomId);
          return round;
        });
      });

      socket.on(WS_EVENTS.START_TIMER, (...args: unknown[]) => {
        const { ack } = this.readArgs<undefined>(args);
        this.run<RoomTimerState>(socket, log, ack, async () => {
          const { roomId } = this.requireSeat(socket);
          await this.service.assertRoomOpen(roomId);
          const state = await this.timer.start(roomId);
          await this.broadcastState(io, roomId);
          return state;
        });
      });

      socket.on(WS_EVENTS.PAUSE_TIMER, (...args: unknown[]) => {
        const { ack } = this.readArgs<undefined>(args);
        this.run<RoomTimerState>(socket, log, ack, async () => {
          const { roomId } = this.requireSeat(socket);
          await this.service.assertRoomOpen(roomId);
          const state = await this.timer.pause(roomId);
          await this.broadcastState(io, roomId);
          return state;
        });
      });

      socket.on(WS_EVENTS.RESET_TIMER, (...args: unknown[]) => {
        const { payload, ack } = this.readArgs<ResetTimerPayload>(args);
        this.run<RoomTimerState>(socket, log, ack, async () => {
          const { roomId } = this.requireSeat(socket);
          await this.service.assertRoomOpen(roomId);
          const state = await this.timer.reset(roomId, payload?.durationSec);
          await this.broadcastState(io, roomId);
          return state;
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
          // призрак останется висеть под второй сессией. Вкладки могут сидеть
          // на других экземплярах сервера (10.18) — ищем по всем
          const targetSocketIds = (await this.presence.members(io, roomId))
            .filter((member) => member.identity.participantId === targetId)
            .map((member) => member.socketId);
          if (targetSocketIds.length > 0) {
            // Адресное событие — прежде чем рвать соединение, иначе клиент не
            // отличит кик от разрыва по протухшему токену (7.7) и тихо
            // переподключится тем же обработчиком. У каждого сокета своя
            // приватная комната с именем-id (заводится Socket.IO сама) — так
            // рассылка попадает ровно в него. Обе команды идут через адаптер
            // по одному каналу и доходят до чужого экземпляра в том же порядке
            io.to(targetSocketIds).emit(WS_SERVER_EVENTS.KICKED, {});
            io.in(targetSocketIds).disconnectSockets(true);
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
          const emoji = payload?.emoji;
          if (!isValidEmojiSequence(emoji)) {
            throw new ValidationError('Недопустимый эмодзи');
          }
          // Адресат должен реально сидеть за столом — иначе реакции на случайные
          // id копились бы в состоянии комнаты без ограничения и без возможности очистки
          const seated = await this.presence.list(io, roomId);
          if (!seated.some((p) => p.participantId === targetId)) {
            throw new ValidationError('Участник не найден в комнате');
          }
          await this.reactions.toggle(roomId, identity.participantId, targetId, emoji);
          await this.broadcastState(io, roomId);
          return null;
        });
      });

      socket.on('disconnect', () => {
        // Сокет к этому моменту уже вышел из каналов — в присутствии его нет
        const roomId = this.presence.seatOf(socket)?.scopeId;
        if (roomId) {
          this.presence.stand(socket);
          this.afterLeave(io, roomId).catch((err: unknown) => {
            log.warn({ err, roomId }, 'Не удалось разослать состояние после выхода участника');
          });
        }
      });
    });
  }

  private async join(
    io: PokerServer,
    socket: PokerSocket,
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
    const previousRoom = this.presence.seatOf(socket)?.scopeId;
    if (previousRoom && previousRoom !== payload.roomId) {
      await socket.leave(previousRoom);
    }

    await socket.join(payload.roomId);
    this.presence.sit(socket, payload.roomId, identity);

    if (previousRoom && previousRoom !== payload.roomId) {
      await this.afterLeave(io, previousRoom);
    }

    // Нового участника показываем всем той же рассылкой, что и остальные события:
    // отдельный снимок мимо очереди мог бы уйти после более свежего
    const state = await this.broadcastState(io, payload.roomId);

    return { state, guestToken, participantId: identity.participantId };
  }

  /**
   * Участник ушёл из комнаты. Стол опустел на всех экземплярах — сиюминутному
   * состоянию таймера и реакций дальше жить незачем
   */
  private async afterLeave(io: PokerServer, roomId: string): Promise<void> {
    const seqKey = this.seqKey(roomId);
    const seen = await this.store.peekSeq(seqKey);
    const { members, complete } = await this.presence.query(io, roomId);
    // Неполный список (сосед не ответил) не повод считать сущность пустой.
    // Пустая — чистим, только если с момента проверки номер снимка не
    // сдвинулся: вход или действие на другом экземпляре рассылают снимок, и
    // тогда стирать уже нельзя (иначе пропал бы только что запущенный таймер)
    if (complete && members.length === 0) {
      await this.store.deleteIfSeq(seqKey, seen, [
        this.timer.storeKey(roomId),
        this.reactions.key(roomId),
      ]);
    }
    await this.broadcastState(io, roomId);
  }

  private seqKey(roomId: string): string {
    return `room-seq:${roomId}`;
  }

  /** Действовать может только тот, кто уже сидит за столом */
  private requireSeat(socket: PokerSocket): { roomId: string; identity: ParticipantIdentity } {
    const seat = this.presence.seatOf(socket);
    if (!seat) {
      throw new ForbiddenError('Сначала войдите в комнату');
    }
    return { roomId: seat.scopeId, identity: seat.identity };
  }

  /**
   * Снимок комнаты всем за столом. Рассылки с разных экземпляров (и даже с
   * одного) могут обогнать друг друга — порядок держит номер снимка (10.18):
   * он берётся ДО чтения состояния, поэтому больший номер всегда у снимка,
   * собранного не раньше, а клиент отбрасывает снимок с меньшим номером.
   */
  private async broadcastState(io: PokerServer, roomId: string): Promise<RoomState> {
    const seq = await this.store.nextSeq(this.seqKey(roomId));
    const [participants, timer, reactions] = await Promise.all([
      this.presence.list(io, roomId),
      this.timer.get(roomId),
      this.reactions.list(roomId),
    ]);
    const state = await this.service.getState(roomId, participants, timer, reactions, seq);
    io.to(roomId).emit(WS_SERVER_EVENTS.ROOM_STATE, state);
    return state;
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
    socket: PokerSocket,
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
