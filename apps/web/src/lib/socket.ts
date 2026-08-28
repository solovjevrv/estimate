/**
 * Обёртка над socket.io-client: типизированные события стола и ответы сервера
 * в виде промисов. Соединение одно на приложение — комнату меняем событием
 * `join_room`, а не новым сокетом.
 */
import type {
  ApplyBoardOpsPayload,
  ApplyBoardOpsResult,
  BoardAwarenessBroadcast,
  BoardAwarenessPayload,
  BoardOpsBatch,
  BoardPresenceEntry,
  JoinBoardPayload,
  JoinBoardResult,
  JoinRoomPayload,
  JoinRoomResult,
  KickParticipantPayload,
  ResetTimerPayload,
  RevealCardsPayload,
  RoomState,
  RoomTimerState,
  Round,
  RoundResult,
  SendReactionPayload,
  StartRoundPayload,
  SubmitVotePayload,
  UpdateLinksPayload,
  WsAck,
} from '@estimate/shared';
import {
  BOARD_WS_EVENTS,
  BOARD_WS_SERVER_EVENTS,
  WS_EVENTS,
  WS_SERVER_EVENTS,
} from '@estimate/shared';
import { io, type Socket } from 'socket.io-client';

/** Отказ сервера в ответ на событие: код тот же, что в REST (`conflict`, `forbidden`, ...) */
export class WsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WsError';
  }
}

/** Сколько ждём ответ на событие, прежде чем считать соединение зависшим */
const ACK_TIMEOUT_MS = 10_000;

interface ServerToClientEvents {
  [WS_SERVER_EVENTS.ROOM_STATE]: (state: RoomState) => void;
  /** Адресное событие только исключённому — приходит перед разрывом соединения */
  [WS_SERVER_EVENTS.KICKED]: (payload: Record<string, never>) => void;
  /** Подтверждённые операции доски — включая эхо своих же (отбрасывается по `clientOpId`) */
  [BOARD_WS_SERVER_EVENTS.OPS]: (batch: BoardOpsBatch) => void;
  /** Курсоры/перетаскивание — не персистится, приходит от всех, кроме себя самого */
  [BOARD_WS_SERVER_EVENTS.AWARENESS]: (payload: BoardAwarenessBroadcast) => void;
  /** Кто сейчас смотрит доску */
  [BOARD_WS_SERVER_EVENTS.PRESENCE]: (entries: BoardPresenceEntry[]) => void;
}

/**
 * Ответы на события: актуальное состояние стола сервер шлёт отдельной рассылкой
 * `room_state` (и до ack), поэтому в самом ack — лишь то, что рассылкой не
 * передаётся. Голос и правка ссылок ничего не возвращают, вскрытие отдаёт итоги
 * раунда, старт — получившийся раунд (текущий, если стол уже ушёл вперёд).
 */
interface ClientToServerEvents {
  [WS_EVENTS.JOIN_ROOM]: (p: JoinRoomPayload, ack: (r: WsAck<JoinRoomResult>) => void) => void;
  [WS_EVENTS.SUBMIT_VOTE]: (p: SubmitVotePayload, ack: (r: WsAck<null>) => void) => void;
  [WS_EVENTS.REVEAL_CARDS]: (p: RevealCardsPayload, ack: (r: WsAck<RoundResult>) => void) => void;
  [WS_EVENTS.START_NEW_ROUND]: (p: StartRoundPayload, ack: (r: WsAck<Round>) => void) => void;
  [WS_EVENTS.UPDATE_LINKS]: (p: UpdateLinksPayload, ack: (r: WsAck<null>) => void) => void;
  [WS_EVENTS.START_TIMER]: (
    p: Record<string, never>,
    ack: (r: WsAck<RoomTimerState>) => void,
  ) => void;
  [WS_EVENTS.PAUSE_TIMER]: (
    p: Record<string, never>,
    ack: (r: WsAck<RoomTimerState>) => void,
  ) => void;
  [WS_EVENTS.RESET_TIMER]: (p: ResetTimerPayload, ack: (r: WsAck<RoomTimerState>) => void) => void;
  [WS_EVENTS.KICK_PARTICIPANT]: (p: KickParticipantPayload, ack: (r: WsAck<null>) => void) => void;
  [WS_EVENTS.SEND_REACTION]: (p: SendReactionPayload, ack: (r: WsAck<null>) => void) => void;
  [BOARD_WS_EVENTS.JOIN]: (p: JoinBoardPayload, ack: (r: WsAck<JoinBoardResult>) => void) => void;
  [BOARD_WS_EVENTS.APPLY]: (
    p: ApplyBoardOpsPayload,
    ack: (r: WsAck<ApplyBoardOpsResult>) => void,
  ) => void;
  /** Без подтверждения — эфемерное событие, ответ не нужен и не ждётся */
  [BOARD_WS_EVENTS.AWARENESS]: (p: BoardAwarenessPayload) => void;
}

export type PokerSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Сокет к тому же origin, откуда открыт фронт: в проде это nginx, в разработке —
 * прокси Vite. Куку сессии браузер отправляет сам, отдельная авторизация не нужна.
 */
export function createSocket(): PokerSocket {
  return io({
    withCredentials: true,
    // Ручное подключение: сокет нужен только на странице комнаты
    autoConnect: false,
  });
}

/**
 * Отправляет событие и ждёт ответ. Сервер отвечает либо данными, либо отказом
 * с кодом — второе приходит промисом-ошибкой, чтобы вызывающий код не разбирал
 * форму ответа сам.
 */
export function emitWithAck<E extends keyof ClientToServerEvents, T>(
  socket: PokerSocket,
  event: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new WsError('timeout', 'Сервер не ответил, проверьте соединение'));
    }, ACK_TIMEOUT_MS);

    const handle = (result: WsAck<T>): void => {
      clearTimeout(timer);
      if (result.ok) {
        resolve(result.data);
      } else {
        reject(new WsError(result.error, result.message));
      }
    };

    // Формы событий сходятся по типам выше, но привязать ack к конкретному
    // событию дженериком TypeScript не даёт — сужаем в одном месте
    (socket.emit as (event: E, payload: unknown, ack: (r: WsAck<T>) => void) => void)(
      event,
      payload,
      handle,
    );
  });
}
