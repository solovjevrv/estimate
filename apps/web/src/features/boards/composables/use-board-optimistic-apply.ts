import type {
  ApplyBoardOpsResult,
  BoardCommittedOp,
  BoardEdge,
  BoardItem,
  BoardOp,
  BoardOpsBatch,
} from '@poker/shared';
import { BOARD_WS_EVENTS, toggleItemReaction } from '@poker/shared';
import { computed, ref } from 'vue';

import { emitWithAck, WsError, type PokerSocket } from '../../../lib/socket';
import { applyLocalBoardOp, type BoardLocalState } from '../domain/apply-local-op';
import {
  BOARD_HISTORY_LIMIT,
  deriveInverseOps,
  filterExistingTargets,
  regenerateClientOpIds,
  type BoardHistoryEntry,
} from '../domain/board-op-history';
import { opTargetKey } from '../domain/board-op-target';

export interface UseBoardOptimisticApplyOptions {
  local: BoardLocalState;
  requireSocket: () => PokerSocket;
  /** participantId пуст до первого join; имя — session.user или гостевое (14.4) */
  self: () => { id: string; name: string };
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

/**
 * Оптимистичное применение операций доски: локальный предикт до ответа
 * сервера (12.6), приём рассылок `board:ops` с фильтром своего же устаревшего
 * эха, откат при отказе сервера (14.4) и стек undo/redo (12.10). Не знает о
 * WS-подключении и join/leave — только даёт `applyBatch`/`applySnapshot` для
 * вызова из обработчиков событий и `resetForNewSession` для сброса при
 * смене доски/выходе (16.5).
 */
export function useBoardOptimisticApply({
  local,
  requireSocket,
  self,
}: UseBoardOptimisticApplyOptions) {
  const revision = ref(0);
  /**
   * Сервер отклонил применённый оптимистично батч (14.4) — например, доступ по
   * ссылке урезали до `view`, пока участник уже редактировал. Новый объект на
   * каждый отказ (не код строкой), чтобы повторный отказ с тем же кодом подряд
   * тоже считался изменением и не терялся в `watch` без `immediate` на странице.
   */
  const applyError = ref<{ code: string } | null>(null);

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
   * на время сессии текущей доски — сбрасывается в `resetForNewSession()`,
   * как и `lastOwnOpByTarget`/`ownClientOpIds` выше.
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
        const key = opTargetKey(op);
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
    const identity = self();
    for (const op of ops) {
      ownClientOpIds.add(op.clientOpId);
      lastOwnOpByTarget.set(opTargetKey(op), op.clientOpId);
      const predicted = predictCommittedOp(op, local, identity);
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
        const predicted = predictCommittedOp(op, local, identity);
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

  /** Смена доски или выход — прошлые ревизия, ошибка и история отмены не имеют смысла на новой/пустой сессии */
  function resetForNewSession(): void {
    revision.value = 0;
    applyError.value = null;
    lastOwnOpByTarget.clear();
    ownClientOpIds.clear();
    clearHistory();
  }

  return {
    revision,
    applyError,
    canUndo,
    canRedo,
    applyBatch,
    applySnapshot,
    applyOps,
    undo,
    redo,
    resetForNewSession,
  };
}
