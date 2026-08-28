import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import type { BoardOpsBatch, JoinBoardResult, WsAck } from '@estimate/shared';
import { BOARD_WS_EVENTS, BOARD_WS_SERVER_EVENTS } from '@estimate/shared';
import { type Socket, io } from 'socket.io-client';

import type { LatencyRecorder } from './metrics';

const ACK_TIMEOUT_MS = 15_000;
const BROADCAST_TIMEOUT_MS = 15_000;

export interface BoardScenarioOptions {
  serverOrigin: string;
  boardId: string;
  ownerCookie: string;
  guestCount: number;
  /** Волн правок: в каждой волне КАЖДЫЙ участник (владелец + гости) правит один элемент почти
   *  одновременно (джиттер) — имитация реальной одновременной работы над одной доской */
  waves: number;
  jitterMs: number;
  joinLatency: LatencyRecorder;
  applyLatency: LatencyRecorder;
  broadcastLatency: LatencyRecorder;
}

export interface BoardScenarioResult {
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

/** Ждёт, что рассылка board:ops с конкретным clientOpId дойдёт до ЭТОГО сокета */
function waitForOpsBatch(socket: Socket, clientOpId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(BOARD_WS_SERVER_EVENTS.OPS, handler);
      reject(new Error('рассылка операции не дошла вовремя'));
    }, BROADCAST_TIMEOUT_MS);
    function handler(batch: BoardOpsBatch): void {
      if (batch.ops.some((op) => op.clientOpId === clientOpId)) {
        clearTimeout(timer);
        socket.off(BOARD_WS_SERVER_EVENTS.OPS, handler);
        resolve();
      }
    }
    socket.on(BOARD_WS_SERVER_EVENTS.OPS, handler);
  });
}

/**
 * Полный цикл жизни N параллельных участников одной (уже наполненной элементами)
 * доски: вход всех (снимок вплоть до тысяч элементов — сама по себе нагрузка на
 * сериализацию/передачу), затем волны почти одновременных правок с замером
 * латентности ack и латентности фан-аута рассылки (по одной опорной операции
 * волны — от владельца, он есть в каждом прогоне детерминированно).
 */
export async function runBoardScenario(opts: BoardScenarioOptions): Promise<BoardScenarioResult> {
  const errors: string[] = [];
  const owner = connect(opts.serverOrigin, opts.ownerCookie);
  const guests = Array.from({ length: opts.guestCount }, () => connect(opts.serverOrigin));
  const all = [owner, ...guests];

  try {
    await Promise.all(all.map(onceConnected));

    let itemIds: string[] = [];
    await Promise.all(
      all.map(async (socket, i) => {
        const startedAt = performance.now();
        const ack = await emit<JoinBoardResult>(socket, BOARD_WS_EVENTS.JOIN, {
          boardId: opts.boardId,
          guestName: i === 0 ? undefined : `Нагрузка ${i}`,
        });
        opts.joinLatency.record(performance.now() - startedAt);
        if (!ack.ok) {
          errors.push(`вход участника ${i}: ${ack.message}`);
          return;
        }
        if (ack.data.snapshot && itemIds.length === 0) {
          itemIds = ack.data.snapshot.items.map((item) => item.id);
        }
      }),
    );

    if (itemIds.length === 0) {
      errors.push('снимок доски пуст или не получен ни одним участником — нечего патчить');
      return { errors };
    }

    for (let wave = 0; wave < opts.waves; wave += 1) {
      // Сервер шлёт рассылку ДО ack (см. boards.gateway.ts: io.to(boardId).emit(...) идёт
      // раньше return { revision }, который становится ack'ом) — слушатели обязаны стоять
      // на всех сокетах ДО отправки операции, иначе разошедшаяся раньше нас рассылка молча
      // потеряется (Socket.IO не буферизует прошлые события для листенеров, добавленных позже).
      const ownerClientOpId = randomUUID();
      const broadcastWaiters = Promise.all(
        all.map((socket) => waitForOpsBatch(socket, ownerClientOpId)),
      );
      let ownerStartedAt = 0;

      await Promise.all(
        all.map(async (socket, i) => {
          await sleep(Math.random() * opts.jitterMs);
          const clientOpId = i === 0 ? ownerClientOpId : randomUUID();
          const targetId = itemIds[(wave * all.length + i) % itemIds.length]!;
          const startedAt = performance.now();
          if (i === 0) ownerStartedAt = startedAt;
          const ack = await emit(socket, BOARD_WS_EVENTS.APPLY, {
            ops: [
              {
                type: 'item.patch',
                clientOpId,
                id: targetId,
                patch: { x: Math.round(Math.random() * 5000), y: Math.round(Math.random() * 5000) },
              },
            ],
          });
          opts.applyLatency.record(performance.now() - startedAt);
          if (!ack.ok) errors.push(`волна ${wave}, участник ${i}: ${ack.message}`);
        }),
      );

      await broadcastWaiters;
      opts.broadcastLatency.record(performance.now() - ownerStartedAt);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    for (const socket of all) socket.close();
  }

  return { errors };
}
