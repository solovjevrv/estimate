/**
 * Реалтайм-сессия доски: соединение по вебсокету, локальное состояние
 * элементов/связей и действия участника (12.4). По образцу `stores/room.ts`:
 * сервер — источник истины, применённые операции просто upsert/delete по id,
 * отставшие рассылки (по `revision`) отбрасываются.
 *
 * Свои же операции (12.6) применяются локально оптимистично — не дожидаясь
 * ответа сервера — а входящее эхо `board:ops` по ним пропускается, если
 * локально уже есть более свежая неподтверждённая правка той же цели
 * (см. `lastOwnOpByTarget`/`ownClientOpIds`).
 */
import type {
  ApplyBoardOpsResult,
  BoardAwarenessBroadcast,
  BoardAwarenessKind,
  BoardCommittedOp,
  BoardEdge,
  BoardItem,
  BoardOp,
  BoardOpsBatch,
  BoardPresenceEntry,
  JoinBoardResult,
} from '@poker/shared';
import { BOARD_WS_EVENTS, BOARD_WS_SERVER_EVENTS, toggleItemReaction } from '@poker/shared';
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';

import { applyLocalBoardOp, type BoardLocalState } from '../lib/board/apply-local-op';
import {
  BOARD_HISTORY_LIMIT,
  deriveInverseOps,
  filterExistingTargets,
  regenerateClientOpIds,
  type BoardHistoryEntry,
} from '../lib/board/board-op-history';
import { createSocket, emitWithAck, type PokerSocket } from '../lib/socket';
import { useSessionStore } from './session';

/** Ключ цели операции — общий для `BoardOp` (клиент → сервер) и `BoardCommittedOp` (рассылка) */
function opTargetKey(op: BoardOp): string {
  switch (op.type) {
    case 'item.create':
      return `item:${op.item.id}`;
    case 'item.patch':
    case 'item.delete':
    case 'item.react':
      return `item:${op.id}`;
    case 'edge.create':
      return `edge:${op.edge.id}`;
    case 'edge.patch':
    case 'edge.delete':
      return `edge:${op.id}`;
  }
}

function committedOpTargetKey(op: BoardCommittedOp): string {
  switch (op.type) {
    case 'item.create':
    case 'item.patch':
      return `item:${op.item.id}`;
    case 'item.delete':
      return `item:${op.id}`;
    case 'edge.create':
    case 'edge.patch':
      return `edge:${op.edge.id}`;
    case 'edge.delete':
      return `edge:${op.id}`;
  }
}

/**
 * Локальное предсказание закоммиченной операции для оптимистичного применения —
 * до ответа сервера. `patch`-варианты мержатся поверх уже известного локального
 * состояния (у сервера мерж будет тот же, если между отправкой и коммитом никто
 * другой не успел его изменить). Возвращает `null`, если применять нечего
 * (цель патча/удаления ещё не появилась локально — подождём настоящее эхо).
 */
function predictCommittedOp(
  op: BoardOp,
  local: BoardLocalState,
  self: { id: string; name: string },
): BoardCommittedOp | null {
  switch (op.type) {
    case 'item.create':
      return {
        type: 'item.create',
        clientOpId: op.clientOpId,
        item: { ...op.item, boardId: '', createdBy: null, updatedAt: new Date().toISOString() },
      };
    case 'item.patch': {
      const existing = local.items.get(op.id);
      if (!existing) return null;
      return {
        type: 'item.patch',
        clientOpId: op.clientOpId,
        item: {
          ...existing,
          ...op.patch,
          style: op.patch.style ? { ...existing.style, ...op.patch.style } : existing.style,
          updatedAt: new Date().toISOString(),
        },
      };
    }
    case 'item.delete':
      return { type: 'item.delete', clientOpId: op.clientOpId, id: op.id };
    case 'item.react': {
      const existing = local.items.get(op.id);
      if (!existing) return null;
      // Рассылается как item.patch (12.12) — реакции не отдельный протокол для
      // других участников, только для нас самих (отдельный BoardOp, чтобы
      // сервер, а не клиент, решал toggle авторитетно)
      return {
        type: 'item.patch',
        clientOpId: op.clientOpId,
        item: {
          ...existing,
          reactions: toggleItemReaction(existing.reactions, self.id, self.name, op.emoji),
          updatedAt: new Date().toISOString(),
        },
      };
    }
    case 'edge.create':
      return {
        type: 'edge.create',
        clientOpId: op.clientOpId,
        edge: { ...op.edge, boardId: '' },
      };
    case 'edge.patch': {
      const existing = local.edges.get(op.id);
      if (!existing) return null;
      return {
        type: 'edge.patch',
        clientOpId: op.clientOpId,
        edge: {
          ...existing,
          ...op.patch,
          style: op.patch.style ? { ...existing.style, ...op.patch.style } : existing.style,
        },
      };
    }
    case 'edge.delete':
      return { type: 'edge.delete', clientOpId: op.clientOpId, id: op.id };
  }
}

export const useBoardSessionStore = defineStore('boardSession', () => {
  const session = useSessionStore();
  const local: BoardLocalState = reactive({ items: new Map(), edges: new Map() });
  const revision = ref(0);
  const presence = ref<BoardPresenceEntry[]>([]);
  const awarenessByUser = reactive(new Map<string, BoardAwarenessBroadcast>());
  const connected = ref(false);
  const joined = ref(false);

  /**
   * clientOpId последней собственной операции, отправленной по каждой цели
   * (item:id/edge:id) — пока не подтверждена именно эта операция, эхо на более
   * старую собственную операцию по той же цели не перетирает уже более свежее
   * локальное состояние (иначе быстрые последовательные правки одного элемента,
   * например перетаскивание, на миг откатывались бы назад по мере прихода эха).
   */
  const lastOwnOpByTarget = new Map<string, string>();
  /** clientOpId'ы, отправленные этим клиентом и ещё не подтверждённые своим же эхо */
  const ownClientOpIds = new Set<string>();

  /**
   * Стек undo/redo (12.10) — инверсные операции, не снимки: снимок в
   * реалтайме затёр бы параллельную правку другого участника. Живёт только
   * на время сессии текущей доски — сбрасывается в `join()`/`leave()`, как и
   * `lastOwnOpByTarget`/`ownClientOpIds` выше.
   */
  const undoStack = ref<BoardHistoryEntry[]>([]);
  const redoStack = ref<BoardHistoryEntry[]>([]);
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function pushHistory(entry: BoardHistoryEntry): void {
    undoStack.value.push(entry);
    if (undoStack.value.length > BOARD_HISTORY_LIMIT) undoStack.value.shift();
    redoStack.value = [];
  }

  function clearHistory(): void {
    undoStack.value = [];
    redoStack.value = [];
  }

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
    for (const op of batch.ops) {
      // Эхо своей же операции — уже применено оптимистично при отправке.
      // Перетираем им локальное состояние, только если это подтверждение
      // САМОЙ ПОСЛЕДНЕЙ нашей операции по этой цели: если после её отправки
      // улетела более новая (например, следующий кадр перетаскивания), это эхо
      // устарело и откатило бы уже показанный пользователю результат — пропускаем
      if (ownClientOpIds.delete(op.clientOpId)) {
        const key = committedOpTargetKey(op);
        if (lastOwnOpByTarget.get(key) === op.clientOpId) {
          lastOwnOpByTarget.delete(key);
        } else {
          continue;
        }
      }
      applyLocalBoardOp(local, op);
    }
    revision.value = batch.revision;
  }

  function applySnapshot(snapshot: { items: BoardItem[]; edges: BoardEdge[] }, rev: number): void {
    local.items.clear();
    local.edges.clear();
    for (const item of snapshot.items) local.items.set(item.id, item);
    for (const edge of snapshot.edges) local.edges.set(edge.id, edge);
    revision.value = rev;
    // Снимок — самая свежая правда сервера целиком, любое ещё не подтверждённое
    // своё эхо по определению устарело им
    lastOwnOpByTarget.clear();
    ownClientOpIds.clear();
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
      lastOwnOpByTarget.clear();
      ownClientOpIds.clear();
      clearHistory();
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
      active.on('disconnect', (reason: string) => {
        connected.value = false;
        // Socket.io сам не переподключается только при 'io server disconnect' —
        // единственной причине, когда сервер намеренно разорвал соединение (деплой,
        // рестарт). В остальных случаях (сеть, таймаут) клиент стянет себя — для
        // presence/cursors (14.1) это критично: без принудительного reconnect после
        // рестарта сервера участники зависнут на мёртвом сокете. Остальное — как у room.ts.
        if (reason === 'io server disconnect' && established) {
          active.connect();
        }
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
    lastOwnOpByTarget.clear();
    ownClientOpIds.clear();
    clearHistory();
  }

  function requireSocket(): PokerSocket {
    if (!socket) throw new Error('Доска не подключена');
    return socket;
  }

  /**
   * Применяется сразу локально (оптимистично, до ответа сервера) и на других
   * участниках — рассылкой `board:ops`, которую отбрасывает `applyBatch` выше,
   * если это устаревшее эхо. Ошибка отправки (сеть/валидация) оптимистичное
   * применение не откатывает — на масштабе 12.6 это осознанный компромисс.
   *
   * `record` (12.10, по умолчанию `true`) — писать ли эту операцию в историю
   * undo/redo; `false` для промежуточных троттлед-тиков одного жеста (драг),
   * чтобы одна отмена откатывала жест целиком, а не последние 80мс. `inverse`
   * — явная инверсия вместо автоматической: тоже для драга, где "старое"
   * значение — позиция на СТАРТЕ жеста, а не то, что было в `local` прямо
   * перед этим конкретным тиком (иначе отмена откатила бы только его).
   */
  async function applyOps(
    ops: BoardOp[],
    opts: { record?: boolean; inverse?: BoardOp[] } = {},
  ): Promise<number> {
    const active = requireSocket();
    const record = opts.record ?? true;
    const inverseOps = record ? (opts.inverse ?? deriveInverseOps(ops, local)) : null;
    const self = { id: session.user?.id ?? '', name: session.user?.name ?? '' };
    for (const op of ops) {
      ownClientOpIds.add(op.clientOpId);
      lastOwnOpByTarget.set(opTargetKey(op), op.clientOpId);
      const predicted = predictCommittedOp(op, local, self);
      if (predicted) applyLocalBoardOp(local, predicted);
    }
    if (inverseOps && inverseOps.length) {
      pushHistory({ forward: ops, backward: inverseOps });
    }
    const result = await emitWithAck<typeof BOARD_WS_EVENTS.APPLY, ApplyBoardOpsResult>(
      active,
      BOARD_WS_EVENTS.APPLY,
      { ops },
    );
    return result.revision;
  }

  /**
   * Отмена/повтор (12.10) — переносят запись между стеками и заново вызывают
   * `applyOps` с `record: false` (сама отмена в историю не пишется — иначе
   * Ctrl+Z создавал бы свою же отменяемую запись). Перед применением цели
   * операций перепроверяются на актуальном `local`: то, что успел удалить
   * другой участник, отбрасывается поштучно, не руша остальные операции той
   * же записи (см. `filterExistingTargets`) — если после фильтра применять
   * нечего, запись просто исчезает со стека без переноса на противоположный.
   */
  async function undo(): Promise<void> {
    const entry = undoStack.value.pop();
    if (!entry) return;
    const backward = filterExistingTargets(entry.backward, local);
    if (!backward.length) return;
    redoStack.value.push(entry);
    await applyOps(regenerateClientOpIds(backward), { record: false });
  }

  async function redo(): Promise<void> {
    const entry = redoStack.value.pop();
    if (!entry) return;
    const forward = filterExistingTargets(entry.forward, local);
    if (!forward.length) return;
    undoStack.value.push(entry);
    await applyOps(regenerateClientOpIds(forward), { record: false });
  }

  /**
   * Курсоры участников — не персистится, throttle на стороне вызывающего кода.
   * Перетаскивание элементов синхронизируется не этим, а обычными throttled
   * `item.patch` через `applyOps` (12.6) — курсоры участников появятся в 14.1.
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
    canUndo,
    canRedo,
    undo,
    redo,
  };
});
