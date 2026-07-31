import { setTimeout as sleep } from 'node:timers/promises';

import type { JoinRoomResult, RoomState, WsAck } from '@poker/shared';
import { WS_EVENTS, WS_SERVER_EVENTS } from '@poker/shared';
import { type Socket, io } from 'socket.io-client';

import type { LatencyRecorder } from './metrics';

const ACK_TIMEOUT_MS = 10_000;
const STATE_TIMEOUT_MS = 15_000;

export interface RoomScenarioOptions {
  serverOrigin: string;
  roomId: string;
  ownerCookie: string;
  guestCount: number;
  rounds: number;
  jitterMs: number;
  voteLatency: LatencyRecorder;
  revealLatency: LatencyRecorder;
}

export interface RoomScenarioResult {
  errors: string[];
}

function connect(serverOrigin: string, cookie?: string): Socket {
  return io(serverOrigin, {
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : {},
  });
}

function onceConnected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('нет подключения к сокету')), ACK_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function emit<T>(socket: Socket, event: string, payload?: unknown): Promise<WsAck<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`нет ответа на ${event}`)), ACK_TIMEOUT_MS);
    const done = (ack: WsAck<T>): void => {
      clearTimeout(timer);
      resolve(ack);
    };
    if (payload === undefined) {
      socket.emit(event, done);
    } else {
      socket.emit(event, payload, done);
    }
  });
}

/**
 * Ждёт именно вскрытый раунд, а не любую рассылку room_state — предыдущие
 * голоса тоже рассылают снимок, и слушатель, поставленный сразу после них,
 * иначе мог бы поймать «повисший» снимок раньше настоящего вскрытия (тот же
 * класс гонки, что нашли в E2E smoke-тесте — см. PROGRESS_ARCHIVE.md, 6.4).
 */
function nextRevealedState(socket: Socket): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(WS_SERVER_EVENTS.ROOM_STATE, handler);
      reject(new Error('вскрытие не дошло вовремя'));
    }, STATE_TIMEOUT_MS);
    function handler(state: RoomState): void {
      if (state.round?.status === 'revealed') {
        clearTimeout(timer);
        socket.off(WS_SERVER_EVENTS.ROOM_STATE, handler);
        resolve(state);
      }
    }
    socket.on(WS_SERVER_EVENTS.ROOM_STATE, handler);
  });
}

/** Полный цикл жизни одной комнаты: вход владельца и гостей, N раундов голосования и вскрытия */
export async function runRoomScenario(opts: RoomScenarioOptions): Promise<RoomScenarioResult> {
  const errors: string[] = [];
  const owner = connect(opts.serverOrigin, opts.ownerCookie);
  const guests = Array.from({ length: opts.guestCount }, () => connect(opts.serverOrigin));

  try {
    await Promise.all([onceConnected(owner), ...guests.map(onceConnected)]);

    const ownerJoin = await emit(owner, WS_EVENTS.JOIN_ROOM, { roomId: opts.roomId });
    if (!ownerJoin.ok) errors.push(`вход владельца: ${ownerJoin.message}`);

    await Promise.all(
      guests.map(async (guest, i) => {
        const ack = await emit<JoinRoomResult>(guest, WS_EVENTS.JOIN_ROOM, {
          roomId: opts.roomId,
          guestName: `Нагрузка ${i + 1}`,
        });
        if (!ack.ok) errors.push(`вход гостя ${i}: ${ack.message}`);
      }),
    );

    for (let round = 0; round < opts.rounds; round += 1) {
      const startAck = await emit(owner, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      if (!startAck.ok) {
        errors.push(`старт раунда ${round}: ${startAck.message}`);
        continue;
      }

      await Promise.all(
        guests.map(async (guest, i) => {
          await sleep(Math.random() * opts.jitterMs);
          const value = FIBONACCI_SAMPLE[i % FIBONACCI_SAMPLE.length] ?? 5;
          const startedAt = performance.now();
          const ack = await emit(guest, WS_EVENTS.SUBMIT_VOTE, { value });
          opts.voteLatency.record(performance.now() - startedAt);
          if (!ack.ok) errors.push(`голос раунда ${round}, гость ${i}: ${ack.message}`);
        }),
      );

      const revealWaiters = guests.map((guest) => nextRevealedState(guest));
      const revealStartedAt = performance.now();
      const revealAck = await emit(owner, WS_EVENTS.REVEAL_CARDS);
      if (!revealAck.ok) errors.push(`вскрытие раунда ${round}: ${revealAck.message}`);
      await Promise.all(revealWaiters);
      opts.revealLatency.record(performance.now() - revealStartedAt);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    owner.close();
    for (const guest of guests) guest.close();
  }

  return { errors };
}

/** Разные значения по кругу — ближе к реальному разбросу оценок, чем единый голос от всех */
const FIBONACCI_SAMPLE = [1, 2, 3, 5, 8, 13, 21];
