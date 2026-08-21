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
  Board,
  BoardAccessLevel,
  BoardAwarenessBroadcast,
  BoardAwarenessKind,
  BoardCameraAwarenessData,
  BoardCommittedOp,
  BoardEdge,
  BoardItem,
  BoardOp,
  BoardOpsBatch,
  BoardPresenceEntry,
  BoardShareRole,
  JoinBoardResult,
} from '@poker/shared';
import { BOARD_WS_EVENTS, BOARD_WS_SERVER_EVENTS, toggleItemReaction } from '@poker/shared';
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';

import { setBoardShare } from '../features/boards/api/boards-api';
import { applyLocalBoardOp, type BoardLocalState } from '../features/boards/domain/apply-local-op';
import {
  BOARD_HISTORY_LIMIT,
  deriveInverseOps,
  filterExistingTargets,
  regenerateClientOpIds,
  type BoardHistoryEntry,
} from '../features/boards/domain/board-op-history';
import { createRealtimeConnection, GuestTokenStore, type JoinContext } from '../lib/realtime';
import { emitWithAck, WsError, type PokerSocket } from '../lib/socket';
import { useSessionStore } from './session';

const guestTokens = new GuestTokenStore('poker:board-guest:');

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
  const awarenessByParticipant = reactive(new Map<string, BoardAwarenessBroadcast>());
  /** Идентификатор участника на доске — для presence/cursors; null до первого входа */
  const participantId = ref<string | null>(null);
  /** Итоговый уровень доступа текущего участника к доске (14.4) */
  const access = ref<BoardAccessLevel>('view');
  /**
   * Сервер отклонил применённый оптимистично батч (14.4) — например, доступ по
   * ссылке урезали до `view`, пока участник уже редактировал. Новый объект на
   * каждый отказ (не код строкой), чтобы повторный отказ с тем же кодом подряд
   * тоже считался изменением и не терялся в `watch` без `immediate` на странице.
   */
  const applyError = ref<{ code: string } | null>(null);
  /**
   * Мягкая блокировка текстового редактирования (14.2) — отдельная карта от
   * `awarenessByParticipant`: если смешать с курсором тем же LWW-приёмом, любой следующий
   * throttled mousemove по пейну (он ловит движение мыши по всему канвасу, даже
   * когда фокус в contenteditable конкретного элемента) затрёт запись об editing
   * обратно на cursor — и индикатор блокировки у остальных погаснет посреди
   * реального редактирования. По одной записи на элемент: последний отправивший
   * `active:true` и держит блокировку, снятие (`active:false`) убирает свою.
   */
  const editingByItem = reactive(new Map<string, { participantId: string; name: string }>());
  /**
   * Последняя транслированная позиция камеры каждого участника (14.5) — отдельно
   * от `awarenessByParticipant`: иначе throttled cursor (каждые 80мс) затирал бы
   * запись камеры того же participantId до того, как её успеет прочитать наблюдатель
   */
  const cameraByParticipant = reactive(new Map<string, BoardCameraAwarenessData>());
  const followedParticipantId = ref<string | null>(null);
  const cameraOfFollowed = computed(() =>
    followedParticipantId.value
      ? (cameraByParticipant.get(followedParticipantId.value) ?? null)
      : null,
  );
  function followParticipant(id: string): void {
    followedParticipantId.value = id;
  }
  function stopFollowing(): void {
    followedParticipantId.value = null;
  }
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

  let boardId: string | null = null;
  /** Имя гостя этого сеанса — self.name в applyOps ниже, пока для него нет session.user */
  let ownGuestName: string | null = null;

  const items = computed(() => [...local.items.values()]);
  const edges = computed(() => [...local.edges.values()]);
  const awareness = computed(() => [...awarenessByParticipant.values()]);

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

  /**
   * Доска берётся из `boardId`, а не из замыкания: при переходе на другую доску
   * на живом сокете вход после обрыва должен вернуть на текущую доску, а не на
   * ту, с которой сессию когда-то начали.
   */
  async function performJoin(active: PokerSocket, ctx: JoinContext): Promise<void> {
    const id = boardId;
    if (!id) return;
    // Гостю сервер требует имя на каждый join, включая реконнект — то же имя,
    // что и при первом входе
    const guestName = ownGuestName ?? undefined;

    const result: JoinBoardResult = await emitWithAck(active, BOARD_WS_EVENTS.JOIN, {
      boardId: id,
      guestName,
      guestToken: guestTokens.read(id),
      // При первом входе на доску (ещё не видели ни одной ревизии) полный
      // снимок дешевле, чем прогонять пустой догон — присылаем только на реконнекте
      sinceRevision: ctx.reconnect ? revision.value : undefined,
    });

    // Пока ждали ответ, вызвали leave() или новый join() — это уже не наш вход
    if (!ctx.isCurrent()) return;

    guestTokens.write(id, result.guestToken);
    participantId.value = result.participantId;
    access.value = result.access;

    if (result.snapshot) {
      applySnapshot(result.snapshot, result.revision);
    } else if (result.catchup) {
      for (const batch of result.catchup) applyBatch(batch);
      revision.value = result.revision;
    }
    joined.value = true;
  }

  /** Доменные события доски — вешаются один раз на каждый созданный сокет */
  function attachBoardListeners(active: PokerSocket): void {
    active.on(BOARD_WS_SERVER_EVENTS.OPS, applyBatch);
    active.on(BOARD_WS_SERVER_EVENTS.PRESENCE, (entries) => {
      presence.value = entries;
      // Awareness (курсоры, 14.1) не приходит событием "участник ушёл" — без
      // этой сверки курсор отключившегося застывал бы на экране навсегда
      // (последняя полученная позиция), так как awarenessByParticipant пополняется,
      // но никогда сам по себе не убывает. presence — источник истины о том,
      // кто сейчас реально на доске.
      const activeIds = new Set(entries.map((entry) => entry.participantId));
      for (const participantId of awarenessByParticipant.keys()) {
        if (!activeIds.has(participantId)) awarenessByParticipant.delete(participantId);
      }
      // Та же самая «призрачная блокировка» (14.2): если участник отключился,
      // его editing-запись тоже навсегда не исчезнет без этой сверки — и
      // элемент останется недоступным для редактирования вечно.
      for (const [itemId, lock] of editingByItem) {
        if (!activeIds.has(lock.participantId)) editingByItem.delete(itemId);
      }
      // Камера того же участника (14.5) тоже не приходит в "ушёл" — чистим вместе
      for (const [id] of cameraByParticipant) {
        if (!activeIds.has(id)) cameraByParticipant.delete(id);
      }
      if (followedParticipantId.value && !activeIds.has(followedParticipantId.value)) {
        followedParticipantId.value = null; // объект слежения ушёл с доски — авто-отписка
      }
    });
    active.on(BOARD_WS_SERVER_EVENTS.AWARENESS, (payload) => {
      // Камера (14.5) — отдельная карта, а не в awarenessByParticipant: иначе
      // throttled cursor (каждые 80мс) затирал бы запись камеры того же
      // participantId до того, как её успеет прочитать наблюдатель follow-mode
      if (payload.kind === 'camera') {
        cameraByParticipant.set(
          payload.participantId,
          payload.data as unknown as BoardCameraAwarenessData,
        );
        return;
      }
      // Мягкая блокировка редактирования (14.2) — отдельная ветка, НЕ
      // трогает awarenessByParticipant: курсорные патчи (mousemove) не должны
      // затирать editing-запись, иначе индикатор блокировки погаснет посреди
      // реального редактирования
      if (payload.kind === 'editing') {
        const { itemId, active: isActive } = payload.data as {
          itemId: string;
          active: boolean;
        };
        if (isActive) {
          editingByItem.set(itemId, {
            participantId: payload.participantId,
            name: payload.name,
          });
        } else if (editingByItem.get(itemId)?.participantId === payload.participantId) {
          editingByItem.delete(itemId);
        }
        return;
      }
      awarenessByParticipant.set(payload.participantId, payload);
    });
  }

  const connection = createRealtimeConnection({
    attach: attachBoardListeners,
    join: performJoin,
  });

  async function join(
    id: string,
    guestName?: string,
    onReconnectFailure?: () => void,
  ): Promise<void> {
    // Смена доски на живом сокете — сбрасываем прошлое состояние, иначе
    // отставшая рассылка старой доски осталась бы на экране
    if (boardId && boardId !== id) {
      local.items.clear();
      local.edges.clear();
      revision.value = 0;
      participantId.value = null;
      access.value = 'view';
      applyError.value = null;
      ownGuestName = null;
      lastOwnOpByTarget.clear();
      ownClientOpIds.clear();
      clearHistory();
      cameraByParticipant.clear();
      followedParticipantId.value = null;
    }
    boardId = id;
    // Имя гостя нужно и на автоматическом входе после обрыва — сервер требует
    // его на каждый join, а второй раз спрашивать пользователя негде
    if (guestName !== undefined) ownGuestName = guestName;
    joined.value = false;

    await connection.open(onReconnectFailure);
  }

  function leave(): void {
    connection.close();
    boardId = null;
    ownGuestName = null;
    joined.value = false;
    participantId.value = null;
    access.value = 'view';
    applyError.value = null;
    local.items.clear();
    local.edges.clear();
    revision.value = 0;
    presence.value = [];
    awarenessByParticipant.clear();
    editingByItem.clear();
    cameraByParticipant.clear();
    followedParticipantId.value = null;
    lastOwnOpByTarget.clear();
    ownClientOpIds.clear();
    clearHistory();
  }

  function requireSocket(): PokerSocket {
    return connection.require('Доска не подключена');
  }

  /**
   * Применяется сразу локально (оптимистично, до ответа сервера) и на других
   * участниках — рассылкой `board:ops`, которую отбрасывает `applyBatch` выше,
   * если это устаревшее эхо.
   *
   * Инверсия считается ВСЕГДА, не только когда пишем в историю (`record`) —
   * она же служит откатом, если сервер отклонит батч (доступ по ссылке урезали
   * до `view`, пока гость уже редактировал, доску заархивировали, гонка с
   * удалением цели другим участником и т.п., 14.4). Без отката локальный
   * холст расходился бы с правдой сервера молча и навсегда, до перезагрузки
   * страницы — участник продолжал бы «редактировать» то, что на самом деле
   * никуда не сохраняется и никому больше не видно.
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
    const inverseOps = opts.inverse ?? deriveInverseOps(ops, local);
    // session.user пуст у гостя (14.4) — тогда участника и имя берём из своего
    // же входа: participantId вернул сервер при join, имя — то, что ввели в форме
    const self = {
      id: participantId.value ?? '',
      name: session.user?.name ?? ownGuestName ?? '',
    };
    for (const op of ops) {
      ownClientOpIds.add(op.clientOpId);
      lastOwnOpByTarget.set(opTargetKey(op), op.clientOpId);
      const predicted = predictCommittedOp(op, local, self);
      if (predicted) applyLocalBoardOp(local, predicted);
    }
    if (record && inverseOps.length) {
      pushHistory({ forward: ops, backward: inverseOps });
    }

    try {
      const result = await emitWithAck<typeof BOARD_WS_EVENTS.APPLY, ApplyBoardOpsResult>(
        active,
        BOARD_WS_EVENTS.APPLY,
        { ops },
      );
      return result.revision;
    } catch (err) {
      // Откатываем локально — тем же приёмом инверсии, что undo, но без
      // отправки на сервер (батч и так только что оттуда отклонён)
      for (const op of inverseOps) {
        const predicted = predictCommittedOp(op, local, self);
        if (predicted) applyLocalBoardOp(local, predicted);
      }
      for (const op of ops) {
        ownClientOpIds.delete(op.clientOpId);
        if (lastOwnOpByTarget.get(opTargetKey(op)) === op.clientOpId) {
          lastOwnOpByTarget.delete(opTargetKey(op));
        }
      }
      applyError.value = { code: err instanceof WsError ? err.code : 'internal' };
      throw err;
    }
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
    connection.current()?.emit(BOARD_WS_EVENTS.AWARENESS, { kind, data });
  }

  async function setShare(role: BoardShareRole | null): Promise<Board> {
    if (!boardId) throw new Error('Нельзя изменить доступ к доске вне активной сессии');
    return setBoardShare(boardId, role);
  }

  return {
    items,
    edges,
    revision,
    presence,
    awareness,
    editingByItem,
    cameraByParticipant,
    followedParticipantId,
    cameraOfFollowed,
    followParticipant,
    stopFollowing,
    connected: connection.connected,
    joined,
    participantId,
    access,
    applyError,
    join,
    leave,
    applyOps,
    sendAwareness,
    canUndo,
    canRedo,
    undo,
    redo,
    setShare,
  };
});
