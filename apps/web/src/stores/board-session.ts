/**
 * Реалтайм-сессия доски: соединение по вебсокету, локальное состояние
 * элементов/связей и действия участника (12.4). По образцу `stores/room.ts`:
 * сервер — источник истины, применённые операции просто upsert/delete по id,
 * отставшие рассылки (по `revision`) отбрасываются.
 */
import type {
  ApplyBoardOpsResult,
  BoardAwarenessBroadcast,
  BoardAwarenessKind,
  BoardEdge,
  BoardItem,
  BoardOp,
  BoardOpsBatch,
  BoardPresenceEntry,
  JoinBoardResult,
} from '@poker/shared';
import { BOARD_WS_EVENTS, BOARD_WS_SERVER_EVENTS } from '@poker/shared';
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';

import { applyLocalBoardOp, type BoardLocalState } from '../lib/board/apply-local-op';
import { createSocket, emitWithAck, type PokerSocket } from '../lib/socket';

export const useBoardSessionStore = defineStore('boardSession', () => {
  const local: BoardLocalState = reactive({ items: new Map(), edges: new Map() });
  const revision = ref(0);
  const presence = ref<BoardPresenceEntry[]>([]);
  const awarenessByUser = reactive(new Map<string, BoardAwarenessBroadcast>());
  const connected = ref(false);
  const joined = ref(false);

  let socket: PokerSocket | null = null;
  let boardId: string | null = null;
  /** Прошёл ли первый успешный вход — по нему отличаем реконнект от начального подключения */
  let established = false;
  /**
   * Растёт при каждом `join()`/`leave()`: `performJoin` сверяет его после
   * ожидания ответа сервера и не применяет результат, если за это время
   * успели выйти или запросить другой вход — тот же приём, что в `room.ts`.
   */
  let joinToken = 0;

  const items = computed(() => [...local.items.values()]);
  const edges = computed(() => [...local.edges.values()]);
  const awareness = computed(() => [...awarenessByUser.values()]);

  function applyBatch(batch: BoardOpsBatch): void {
    // Батч мог обогнать ответ на join (или прийти повторно) — отбрасываем отставшее
    if (batch.revision <= revision.value) return;
    for (const op of batch.ops) applyLocalBoardOp(local, op);
    revision.value = batch.revision;
  }

  function applySnapshot(snapshot: { items: BoardItem[]; edges: BoardEdge[] }, rev: number): void {
    local.items.clear();
    local.edges.clear();
    for (const item of snapshot.items) local.items.set(item.id, item);
    for (const edge of snapshot.edges) local.edges.set(edge.id, edge);
    revision.value = rev;
  }

  async function performJoin(id: string): Promise<void> {
    const active = socket;
    if (!active) return;
    const token = joinToken;

    const result: JoinBoardResult = await emitWithAck(active, BOARD_WS_EVENTS.JOIN, {
      boardId: id,
      // При первом входе на доску (ещё не видели ни одной ревизии) полный
      // снимок дешевле, чем прогонять пустой догон — присылаем только на реконнекте
      sinceRevision: established ? revision.value : undefined,
    });

    // Пока ждали ответ, вызвали leave() или новый join() — это уже не наш вход
    if (token !== joinToken) return;

    if (result.snapshot) {
      applySnapshot(result.snapshot, result.revision);
    } else if (result.catchup) {
      for (const batch of result.catchup) applyBatch(batch);
      revision.value = result.revision;
    }
    joined.value = true;
  }

  async function join(id: string): Promise<void> {
    // Смена доски на живом сокете — сбрасываем прошлое состояние, иначе
    // отставшая рассылка старой доски осталась бы на экране
    if (boardId && boardId !== id) {
      local.items.clear();
      local.edges.clear();
      revision.value = 0;
      established = false;
    }
    boardId = id;
    joined.value = false;
    joinToken++;

    socket ??= createSocket();
    const active = socket;

    if (!active.hasListeners(BOARD_WS_SERVER_EVENTS.OPS)) {
      active.on(BOARD_WS_SERVER_EVENTS.OPS, applyBatch);
      active.on(BOARD_WS_SERVER_EVENTS.PRESENCE, (entries) => {
        presence.value = entries;
      });
      active.on(BOARD_WS_SERVER_EVENTS.AWARENESS, (payload) => {
        awarenessByUser.set(payload.userId, payload);
      });
      active.on('connect', () => {
        connected.value = true;
        // Место на доске не переживает обрыв соединения — после переподключения
        // входим заново. Первый connect не трогаем — вход по нему сделает join() ниже
        if (established) {
          void performJoin(id);
        }
      });
      active.on('disconnect', () => {
        connected.value = false;
      });
    }

    if (!active.connected) {
      active.connect();
    }

    await performJoin(id);
    established = true;
  }

  function leave(): void {
    joinToken++;
    socket?.disconnect();
    socket = null;
    boardId = null;
    established = false;
    joined.value = false;
    connected.value = false;
    local.items.clear();
    local.edges.clear();
    revision.value = 0;
    presence.value = [];
    awarenessByUser.clear();
  }

  function requireSocket(): PokerSocket {
    if (!socket) throw new Error('Доска не подключена');
    return socket;
  }

  /** Применяется сразу локально (эхо) и на других участниках — рассылкой `board:ops` */
  async function applyOps(ops: BoardOp[]): Promise<number> {
    const result = await emitWithAck<typeof BOARD_WS_EVENTS.APPLY, ApplyBoardOpsResult>(
      requireSocket(),
      BOARD_WS_EVENTS.APPLY,
      { ops },
    );
    return result.revision;
  }

  /**
   * Курсор/перетаскивание — не персистится, throttle на стороне вызывающего
   * кода (UI ещё не готов, появится вместе с холстом в 12.5+).
   */
  function sendAwareness(kind: BoardAwarenessKind, data: Record<string, unknown>): void {
    socket?.emit(BOARD_WS_EVENTS.AWARENESS, { kind, data });
  }

  return {
    items,
    edges,
    revision,
    presence,
    awareness,
    connected,
    joined,
    join,
    leave,
    applyOps,
    sendAwareness,
  };
});
