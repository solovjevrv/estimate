import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import type { BoardOpsBatch, BoardVotingState, JoinBoardResult, WsAck } from '@estimate/shared';
import { BOARD_WS_EVENTS, BOARD_WS_SERVER_EVENTS, isVotableContent } from '@estimate/shared';
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
  /** Раундов голосования точками (15.2) после волн правок; 0 — без голосования */
  votingRounds: number;
  votesPerParticipant: number;
  voting: VotingLatencies;
}

/** Замеры голосования точками (15.2) — рассылка `board:voting` персональная, на каждого своя */
export interface VotingLatencies {
  /** Старт → снимок активного голосования дошёл до всех */
  start: LatencyRecorder;
  /** Точка → ack (ack уходит после персональной рассылки всем на доске) */
  voteAck: LatencyRecorder;
  /** Начало раунда → у всех `votedCount` равен числу участников */
  settle: LatencyRecorder;
  /** Завершение → итоги дошли до всех */
  close: LatencyRecorder;
  /** Сколько снимков `board:voting` получил один участник за раунд (среднее по всем) */
  messagesPerParticipant: number[];
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

/** Ждёт на ЭТОМ сокете снимок голосования, удовлетворяющий условию */
function waitForVoting(
  socket: Socket,
  match: (state: BoardVotingState | null) => boolean,
): Promise<BoardVotingState | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(BOARD_WS_SERVER_EVENTS.VOTING, handler);
      reject(new Error('снимок голосования не дошёл вовремя'));
    }, BROADCAST_TIMEOUT_MS);
    function handler(state: BoardVotingState | null): void {
      if (match(state)) {
        clearTimeout(timer);
        socket.off(BOARD_WS_SERVER_EVENTS.VOTING, handler);
        resolve(state);
      }
    }
    socket.on(BOARD_WS_SERVER_EVENTS.VOTING, handler);
  });
}

/**
 * Раунд голосования точками: владелец запускает (вся доска, N точек на
 * человека, на элемент без ограничения), все участники почти одновременно
 * ставят по N точек с джиттером между кликами, владелец завершает. Каждая
 * точка — транзакция с блокировкой строки голосования и персональная рассылка
 * всем на доске: N участников × N точек × N получателей.
 */
async function runVotingRound(
  all: Socket[],
  votableIds: string[],
  round: number,
  opts: BoardScenarioOptions,
  errors: string[],
): Promise<void> {
  const owner = all[0]!;
  const received = all.map(() => 0);
  const counters = all.map((socket, i) => {
    const handler = (): void => {
      received[i] = (received[i] ?? 0) + 1;
    };
    socket.on(BOARD_WS_SERVER_EVENTS.VOTING, handler);
    return () => socket.off(BOARD_WS_SERVER_EVENTS.VOTING, handler);
  });

  try {
    const started = Promise.all(all.map((s) => waitForVoting(s, (v) => v?.status === 'active')));
    const startAt = performance.now();
    const startAck = await emit(owner, BOARD_WS_EVENTS.VOTING_START, {
      votesPerParticipant: opts.votesPerParticipant,
      maxPerItem: null,
      itemIds: null,
    });
    if (!startAck.ok) {
      errors.push(`голосование ${round}, старт: ${startAck.message}`);
      return;
    }
    const [ownerState] = await started;
    opts.voting.start.record(performance.now() - startAt);
    const votingId = ownerState?.id ?? '';

    const settled = Promise.all(
      all.map((s) =>
        waitForVoting(s, (v) => v?.status === 'active' && v.votedCount === all.length),
      ),
    );
    const roundAt = performance.now();
    await Promise.all(
      all.map(async (socket, i) => {
        for (let k = 0; k < opts.votesPerParticipant; k += 1) {
          await sleep(Math.random() * opts.jitterMs);
          const itemId = votableIds[(round * 7 + i * 3 + k) % votableIds.length]!;
          const startedAt = performance.now();
          const ack = await emit(socket, BOARD_WS_EVENTS.VOTING_VOTE, {
            votingId,
            itemId,
            delta: 1,
          });
          opts.voting.voteAck.record(performance.now() - startedAt);
          if (!ack.ok) errors.push(`голосование ${round}, участник ${i}: ${ack.message}`);
        }
      }),
    );
    await settled;
    opts.voting.settle.record(performance.now() - roundAt);

    const closed = Promise.all(
      all.map((s) => waitForVoting(s, (v) => v?.status === 'closed' && v.results !== null)),
    );
    const closeAt = performance.now();
    const closeAck = await emit(owner, BOARD_WS_EVENTS.VOTING_CLOSE, {
      votingId,
    });
    if (!closeAck.ok) {
      errors.push(`голосование ${round}, завершение: ${closeAck.message}`);
      return;
    }
    await closed;
    opts.voting.close.record(performance.now() - closeAt);
  } finally {
    for (const off of counters) off();
    const avg = received.reduce((a, b) => a + b, 0) / received.length;
    opts.voting.messagesPerParticipant.push(Math.round(avg));
  }
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
    let votableItemIds: string[] = [];
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
          votableItemIds = ack.data.snapshot.items
            .filter((item) => isVotableContent(item.content))
            .map((item) => item.id);
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

    for (let round = 0; round < opts.votingRounds; round += 1) {
      await runVotingRound(all, votableItemIds, round, opts, errors);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    for (const socket of all) socket.close();
  }

  return { errors };
}
