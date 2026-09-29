import type { BoardEdgeStyle, BoardOp } from '@estimate/shared';
import { ref, type Ref } from 'vue';

export interface UseEdgeCurveOffsetOptions {
  canEdit: () => boolean;
  edgeId: () => string;
  currentStyle: () => BoardEdgeStyle;
  currentCurveOffset: () => { x: number; y: number } | null;
  getStraightMid: () => { x: number; y: number };
  toWorldPoint: (event: PointerEvent) => { x: number; y: number };
  applyOps: (ops: BoardOp[]) => void;
}

export interface UseEdgeCurveOffsetResult {
  dragOffsetPreview: Ref<{ x: number; y: number } | null>;
  onCurveHandlePointerDown: (event: PointerEvent) => void;
  onCurveHandlePointerMove: (event: PointerEvent) => void;
  onCurveHandlePointerUp: () => void;
  resetCurveOffset: () => void;
  cleanup: () => void;
}

const CURVE_OFFSET_RESET_EPSILON = 4;

/**
 * Ручка изгиба связи (12.17) — перетаскивание локального смещения апекса
 * кривой. Коммит одним edge.patch на pointerup, как NodeResizer/@resize-end.
 * Вынесено в отдельный composable из `BoardFloatingEdge.vue` (файл упирался в
 * `max-lines` ESLint) — единственный потребитель тот же компонент.
 */
export function useEdgeCurveOffset(options: UseEdgeCurveOffsetOptions): UseEdgeCurveOffsetResult {
  const dragOffsetPreview = ref<{ x: number; y: number } | null>(null);

  function commitCurveOffset(offset: { x: number; y: number } | null): void {
    if (offset === (options.currentCurveOffset() ?? null)) return;
    options.applyOps([
      {
        type: 'edge.patch',
        clientOpId: globalThis.crypto.randomUUID(),
        id: options.edgeId(),
        patch: { style: { ...options.currentStyle(), curveOffset: offset } },
      },
    ]);
  }

  function onCurveDragKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    dragOffsetPreview.value = null;
    window.removeEventListener('keydown', onCurveDragKeydown);
  }

  function onCurveHandlePointerDown(event: PointerEvent): void {
    if (!options.canEdit()) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const start = options.toWorldPoint(event);
    const mid = options.getStraightMid();
    dragOffsetPreview.value = { x: start.x - mid.x, y: start.y - mid.y };
    window.addEventListener('keydown', onCurveDragKeydown);
  }

  function onCurveHandlePointerMove(event: PointerEvent): void {
    if (!dragOffsetPreview.value) return;
    const point = options.toWorldPoint(event);
    const mid = options.getStraightMid();
    dragOffsetPreview.value = { x: point.x - mid.x, y: point.y - mid.y };
  }

  function onCurveHandlePointerUp(): void {
    if (!dragOffsetPreview.value) return;
    const offset = dragOffsetPreview.value;
    dragOffsetPreview.value = null;
    window.removeEventListener('keydown', onCurveDragKeydown);
    const magnitude = Math.hypot(offset.x, offset.y);
    commitCurveOffset(magnitude < CURVE_OFFSET_RESET_EPSILON ? null : offset);
  }

  function resetCurveOffset(): void {
    if (!options.canEdit()) return;
    commitCurveOffset(null);
  }

  function cleanup(): void {
    window.removeEventListener('keydown', onCurveDragKeydown);
  }

  return {
    dragOffsetPreview,
    onCurveHandlePointerDown,
    onCurveHandlePointerMove,
    onCurveHandlePointerUp,
    resetCurveOffset,
    cleanup,
  };
}
