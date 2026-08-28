import type { BoardOp } from '@estimate/shared';
import { ref, type Ref } from 'vue';

import type { BoardFlowNode } from '../adapters/vue-flow-adapter';
import { type EdgeAnchorSide, nearestSide } from '../domain/floating-edge-geometry';

export interface EdgeReconnectPreview {
  end: 'source' | 'target';
  x: number;
  y: number;
}

export interface UseEdgeReconnectOptions {
  canEdit: () => boolean;
  edgeId: () => string;
  currentSourceItemId: () => string;
  currentTargetItemId: () => string;
  currentSourceHandle: () => string | null;
  currentTargetHandle: () => string | null;
  getNodes: () => BoardFlowNode[];
  toWorldPoint: (event: PointerEvent) => { x: number; y: number };
  applyOps: (ops: BoardOp[]) => void;
}

export interface UseEdgeReconnectResult {
  dragReconnectPreview: Ref<EdgeReconnectPreview | null>;
  onReconnectPointerDown: (end: 'source' | 'target', event: PointerEvent) => void;
  onReconnectPointerMove: (event: PointerEvent) => void;
  onReconnectPointerUp: () => void;
  cleanup: () => void;
}

const RECONNECT_HOVER_CLASS = 'board-node--reconnect-hover';

/**
 * Ручное перецепление конца связи (12.20) — Miro-приём: перетащить конец
 * СУЩЕСТВУЮЩЕЙ стрелки на другую сторону карточки или на другую карточку
 * целиком. Не через Vue Flow-нативный `edgesUpdatable`/`EdgeUpdaterHandle` —
 * та ручка полностью прозрачна (нет своего визуала, только hit-area в 10px
 * ровно на точке крепления), пользователь не видел, что её вообще можно
 * ухватить. Здесь — свой видимый хендл (рисует `BoardFloatingEdge.vue`) и
 * свой драг, по тому же паттерну, что уже применён для ручки изгиба (12.17) и
 * подписи (12.18): локальный preview без сетевых op на каждый pointermove,
 * один edge.patch на pointerup.
 *
 * Точка сброса определяется не точным попаданием в 10px-хендл карточки
 * (`nearestSide`), а ближайшей из 4 сторон карточки ПОД курсором — курсор
 * не обязан идти ровно по хендлу, только оказаться над нужной карточкой.
 *
 * Вынесено в отдельный composable из `BoardFloatingEdge.vue` (уже был почти
 * 800 строк script — `max-lines` ESLint), а не потому что логика переиспользуется
 * где-то ещё — единственный потребитель тот же компонент, просто перестал
 * помещаться в лимит файла целиком.
 */
export function useEdgeReconnect(options: UseEdgeReconnectOptions): UseEdgeReconnectResult {
  const dragReconnectPreview = ref<EdgeReconnectPreview | null>(null);
  let reconnectHoverNodeEl: Element | null = null;
  let reconnectDropNodeId: string | null = null;
  let reconnectDropHandle: EdgeAnchorSide | null = null;

  function clearReconnectHover(): void {
    reconnectHoverNodeEl?.classList.remove(RECONNECT_HOVER_CLASS);
    reconnectHoverNodeEl = null;
  }

  /**
   * `elementsFromPoint` (не `elementFromPoint`) — сама перетаскиваемая ручка
   * следует за курсором, поэтому она физически оказывается ровно под курсором
   * и перекрывала бы то, что под ней, если проверять только самый верхний
   * элемент; пропускаем свои же `.board-edge-reconnect-handle` в стеке и
   * берём первый элемент под ними. Конец связи (эта карточка) и карточка-цель
   * рендерятся независимыми компонентами без общего реактивного состояния,
   * подсветка ставится императивно через DOM (тот же класс, что делает
   * коннект-хендлы карточки видимыми при выделении — `board-connect-handle.css`).
   */
  function updateReconnectDropTarget(event: PointerEvent): void {
    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    const el = stack.find(
      (candidate) => !candidate.closest('[data-testid="board-edge-reconnect-handle"]'),
    );
    const nodeEl = el?.closest('.vue-flow__node') ?? null;
    const nodeId = nodeEl?.getAttribute('data-id') ?? null;
    // Самопетля разрешена (12.21) — карточка на другом (фиксированном) конце
    // связи такая же валидная цель сброса, как и любая другая.
    const isValidTarget = nodeId !== null;

    if (nodeEl !== reconnectHoverNodeEl) {
      clearReconnectHover();
      if (isValidTarget && nodeEl) {
        nodeEl.classList.add(RECONNECT_HOVER_CLASS);
        reconnectHoverNodeEl = nodeEl;
      }
    }

    if (!isValidTarget) {
      reconnectDropNodeId = null;
      reconnectDropHandle = null;
      return;
    }
    const targetNode = options.getNodes().find((candidate) => candidate.id === nodeId);
    if (!targetNode) {
      reconnectDropNodeId = null;
      reconnectDropHandle = null;
      return;
    }
    reconnectDropNodeId = nodeId;
    reconnectDropHandle = nearestSide(targetNode, options.toWorldPoint(event));
  }

  function onReconnectDragKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    dragReconnectPreview.value = null;
    clearReconnectHover();
    reconnectDropNodeId = null;
    reconnectDropHandle = null;
    window.removeEventListener('keydown', onReconnectDragKeydown);
  }

  function onReconnectPointerDown(end: 'source' | 'target', event: PointerEvent): void {
    if (!options.canEdit()) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const point = options.toWorldPoint(event);
    dragReconnectPreview.value = { end, x: point.x, y: point.y };
    window.addEventListener('keydown', onReconnectDragKeydown);
  }

  function onReconnectPointerMove(event: PointerEvent): void {
    const preview = dragReconnectPreview.value;
    if (!preview) return;
    const point = options.toWorldPoint(event);
    dragReconnectPreview.value = { ...preview, x: point.x, y: point.y };
    updateReconnectDropTarget(event);
  }

  function commitReconnect(end: 'source' | 'target', nodeId: string, handle: EdgeAnchorSide): void {
    const currentItemId =
      end === 'source' ? options.currentSourceItemId() : options.currentTargetItemId();
    const currentHandle =
      end === 'source' ? options.currentSourceHandle() : options.currentTargetHandle();
    if (nodeId === currentItemId && handle === currentHandle) return;
    options.applyOps([
      {
        type: 'edge.patch',
        clientOpId: globalThis.crypto.randomUUID(),
        id: options.edgeId(),
        patch:
          end === 'source'
            ? { sourceItemId: nodeId, sourceHandle: handle }
            : { targetItemId: nodeId, targetHandle: handle },
      },
    ]);
  }

  function onReconnectPointerUp(): void {
    const preview = dragReconnectPreview.value;
    dragReconnectPreview.value = null;
    window.removeEventListener('keydown', onReconnectDragKeydown);
    clearReconnectHover();
    const nodeId = reconnectDropNodeId;
    const handle = reconnectDropHandle;
    reconnectDropNodeId = null;
    reconnectDropHandle = null;
    // Отпустили не над карточкой (пустой канвас) — отмена, связь остаётся как
    // была. Никакого auto-выбора «ближайшей стороны» без явного намерения
    // пользователя — та же осторожность, что и в 12.8.
    if (!preview || !nodeId || !handle) return;
    commitReconnect(preview.end, nodeId, handle);
  }

  function cleanup(): void {
    window.removeEventListener('keydown', onReconnectDragKeydown);
    clearReconnectHover();
  }

  return {
    dragReconnectPreview,
    onReconnectPointerDown,
    onReconnectPointerMove,
    onReconnectPointerUp,
    cleanup,
  };
}
