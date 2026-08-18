/**
 * Drag, group cascade, snap-направляющие и throttle-рассылка позиций элементов
 * доски (12.6, 13.6, 14.3). Вынесено из `BoardCanvas.vue` — canvas остаётся
 * владельцем Vue Flow, Pinia-сессии, DOM, курсора и lifecycle-хуков; здесь только
 * чистая drag/snap-логика над flatten-снимком элементов.
 *
 * Принятые правила (см. ТЗ 19.30):
 * - drag элементов и групп;
 * - каскадное перемещение frame/групп;
 * - parentId при входе/выходе из frame;
 * - Shift axis-lock;
 * - snap-направляющие и применение snap только на drag-stop;
 * - throttled промежуточные операции и одну undo-запись на финале;
 * - очистка состояния при смене доски/размонтаже.
 */
import type { BoardItem, BoardItemPatchOp, BoardOp } from '@poker/shared';
import { isBoardContainer } from '@poker/shared';
import { ref, type Ref } from 'vue';

import { BOARD_DRAG_THROTTLE_MS } from '../../../lib/board/board-constants';
import {
  computeSnapGuides,
  SNAP_THRESHOLD_PX,
  type SnapGuide,
  type SnapRect,
} from '../../../lib/board/board-snap';
import type { BoardDragEvent, BoardDragNode } from '../../../lib/board/vue-flow-adapter';
import { throttle } from '../../../lib/throttle';
import { uuid } from '../../../lib/board/uuid';

export interface BoardApplyOptions {
  record?: boolean;
  inverse?: BoardOp[];
}

export interface BoardDragAndSnapOptions {
  canEdit: () => boolean;

  /** Авторитетный плоский snapshot элементов доски. */
  getItems: () => BoardItem[];
  /** Живые узлы, структурно совместимые с Vue Flow `GraphNode` через `BoardDragNode`. */
  getNodes: () => BoardDragNode[];
  /** Текущий zoom нужен только для перевода snap threshold в координаты доски. */
  getZoom: () => number;

  /**
   * Вызывается для оптимистичного применения и отправки операций.
   * Promise намеренно не ожидается в drag-handler.
   */
  applyOps: (ops: BoardOp[], options?: BoardApplyOptions) => void | Promise<unknown>;

  /** Снимает follow-mode при начале пользовательского редактирования. */
  breakFollowOnEdit: () => void;

  /**
   * Ищет только frame по canvas-координате. Group никогда не возвращается.
   * При пересечении frame Canvas выбирает наименьший по площади.
   */
  findFrameAt: (point: { x: number; y: number }, excludeId?: string) => BoardItem | undefined;
}

export interface BoardDragAndSnap {
  activeSnapGuides: Ref<SnapGuide[]>;
  isDragging: Ref<boolean>;

  onNodeDragStart: (event: BoardDragEvent) => void;
  onNodeDrag: (event: BoardDragEvent) => void;
  onNodeDragStop: (event: BoardDragEvent) => void;

  /** Отменяет trailing throttles и очищает все drag/snap-состояния. Идемпотентен. */
  reset: () => void;
}

// Доменные типы BoardItem/BoardOp не должны получать полей Vue Flow: все
// преобразования — через BoardDragNode из vue-flow-adapter.ts.

export function useBoardDragAndSnap(options: BoardDragAndSnapOptions): BoardDragAndSnap {
  const { canEdit, getItems, getNodes, getZoom, applyOps, breakFollowOnEdit, findFrameAt } =
    options;

  // --- Состояние composable (локальное, не реактивное для внутренней логики) ---

  /** Стартовые позиции узлов на момент начала drag-жеста — основа для delta и inverse */
  const dragStartPositions = new Map<string, { x: number; y: number }>();
  /** Активные snap-направляющие для отрисовки во время drag */
  const activeSnapGuides = ref<SnapGuide[]>([]);
  /** Флаг активного drag — Map.size не реактивен, поэтому отдельный ref для Canvas */
  const isDragging = ref(false);

  /** Per-node throttle-обёртки для позиционных тиков drag */
  const dragThrottlers = new Map<string, ReturnType<typeof throttle<[BoardDragNode]>>>();

  // --- Чистые вспомогательные функции (без сайд-эффектов) ---

  /** Дети контейнера (frame/group) по их flat parentId */
  function childrenOf(containerId: string): BoardItem[] {
    return getItems().filter((candidate) => candidate.parentId === containerId);
  }

  /** Конвертирует узел в SnapRect для вычисления snap guide */
  function nodeToSnapRect(node: BoardDragNode): SnapRect {
    return {
      id: node.id,
      x: node.computedPosition.x,
      y: node.computedPosition.y,
      width: node.dimensions.width,
      height: node.dimensions.height,
    };
  }

  /** Сдвиг {id → {x,y}} на дельту от собственного старта, каждого по СВОЕЙ стартовой позиции */
  function shiftOps(
    mates: readonly BoardItem[],
    dx: number,
    dy: number,
  ): { ops: BoardOp[]; inverse: BoardOp[] } {
    const ops: BoardOp[] = [];
    const inverse: BoardOp[] = [];
    for (const mate of mates) {
      const start = dragStartPositions.get(mate.id) ?? { x: mate.x, y: mate.y };
      ops.push({
        type: 'item.patch',
        clientOpId: uuid(),
        id: mate.id,
        patch: { x: start.x + dx, y: start.y + dy },
      });
      inverse.push({
        type: 'item.patch',
        clientOpId: uuid(),
        id: mate.id,
        patch: { x: start.x, y: start.y },
      });
    }
    return { ops, inverse };
  }

  /**
   * Патчи-спутники драга ОДНОГО узла (14.3) — то, что должно сдвинуться на ту
   * же дельту, что и сам перетаскиваемый узел, но не входит в `event.nodes`
   * (Vue Flow не включает туда ни детей контейнера, ни соседей по группе).
   * Два случая:
   * - контейнер (frame/group): тащим за собой всех его детей — дельта считается
   *   от старта самого контейнера;
   * - участник группы: группа — жёсткий пучок, драг любого участника двигает
   *   саму группу-контейнер и всех остальных участников.
   */
  function dragCascadeOps(node: BoardDragNode): { ops: BoardOp[]; inverse: BoardOp[] } {
    const start = dragStartPositions.get(node.id);
    if (!start) return { ops: [], inverse: [] };
    const dx = node.computedPosition.x - start.x;
    const dy = node.computedPosition.y - start.y;
    if (isBoardContainer(node.data.content.type)) {
      return shiftOps(childrenOf(node.id), dx, dy);
    }
    if (node.data.parentId !== null) {
      const parent = getItems().find((candidate) => candidate.id === node.data.parentId);
      if (parent?.content.type === 'group') {
        const mates = [parent, ...childrenOf(parent.id).filter((mate) => mate.id !== node.id)];
        return shiftOps(mates, dx, dy);
      }
    }
    return { ops: [], inverse: [] };
  }

  /**
   * Родитель, который должен получить перетаскиваемый узел на dragStop (14.3).
   * Контейнеры сами никогда не вкладываются. Участник группы сохраняет текущий
   * parentId — членство жёсткое, меняется только явным «Разгруппировать».
   * Верхнеуровневый элемент или участник фрейма — родитель пересчитывается от
   * текущей позиции всегда, чтобы узнать, что элемент вытащили за пределы фрейма.
   */
  function resolveDragParent(node: BoardDragNode): string | null {
    if (isBoardContainer(node.data.content.type)) return null;
    const parent =
      node.data.parentId !== null
        ? getItems().find((candidate) => candidate.id === node.data.parentId)
        : undefined;
    if (parent?.content.type === 'group') return node.data.parentId;
    const center = {
      x: node.computedPosition.x + node.dimensions.width / 2,
      y: node.computedPosition.y + node.dimensions.height / 2,
    };
    return findFrameAt(center, node.id)?.id ?? null;
  }

  /**
   * Все узлы, чью стартовую позицию нужно засеять вместе с самим `node` (14.3):
   * дети контейнера ИЛИ соседи по группе (включая саму группу-обёртку).
   */
  function dragFamilyOf(node: BoardItem): BoardItem[] {
    if (isBoardContainer(node.content.type)) return childrenOf(node.id);
    if (node.parentId !== null) {
      const parent = getItems().find((candidate) => candidate.id === node.parentId);
      if (parent?.content.type === 'group') {
        return [parent, ...childrenOf(parent.id).filter((mate) => mate.id !== node.id)];
      }
    }
    return [];
  }

  /** Сравнение snap-гидов по значениям, чтобы не писать в ref если набор не изменился */
  function guidesEqual(a: SnapGuide[], b: SnapGuide[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const g1 = a[i]!;
      const g2 = b[i]!;
      if (
        g1.orientation !== g2.orientation ||
        g1.position !== g2.position ||
        g1.from !== g2.from ||
        g1.to !== g2.to ||
        g1.targetIds.length !== g2.targetIds.length ||
        g1.targetIds.some((id, idx) => id !== g2.targetIds[idx])
      ) {
        return false;
      }
    }
    return true;
  }

  // --- Snap и axis-lock ---

  function updateSnapGuides(event: BoardDragEvent): void {
    const dragged = event.nodes;
    if (dragged.length === 0) {
      if (activeSnapGuides.value.length > 0) activeSnapGuides.value = [];
      return;
    }
    const draggedIds = new Set(dragged.map((n) => n.id));
    const staticRects = getNodes()
      .filter((n) => !draggedIds.has(n.id))
      .map(nodeToSnapRect);
    const draggedRects = dragged.map(nodeToSnapRect);
    const threshold = SNAP_THRESHOLD_PX / Math.max(getZoom(), 0.1);
    const result = computeSnapGuides(draggedRects, staticRects, threshold);
    if (!guidesEqual(result.guides, activeSnapGuides.value)) {
      activeSnapGuides.value = result.guides;
    }
  }

  function applySnapPosition(event: BoardDragEvent): void {
    const dragged = event.nodes;
    if (dragged.length === 0) return;
    const draggedIds = new Set(dragged.map((n) => n.id));
    const staticRects = getNodes()
      .filter((n) => !draggedIds.has(n.id))
      .map(nodeToSnapRect);
    const draggedRects = dragged.map(nodeToSnapRect);
    const threshold = SNAP_THRESHOLD_PX / Math.max(getZoom(), 0.1);
    const result = computeSnapGuides(draggedRects, staticRects, threshold);

    for (const node of dragged) {
      const snapped = result.positions.get(node.id);
      if (snapped) {
        node.computedPosition.x = snapped.x;
        node.computedPosition.y = snapped.y;
        node.position.x = snapped.x;
        node.position.y = snapped.y;
      }
    }
  }

  /** Shift+drag — ограничение перетаскивания по одной оси */
  function applyAxisLock(event: BoardDragEvent): void {
    if (!(event.event instanceof MouseEvent) || !event.event.shiftKey) return;
    for (const node of event.nodes) {
      const start = dragStartPositions.get(node.id);
      if (!start) continue;
      const dx = node.computedPosition.x - start.x;
      const dy = node.computedPosition.y - start.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        node.computedPosition.y = start.y;
        node.position.y = start.y;
      } else {
        node.computedPosition.x = start.x;
        node.position.x = start.x;
      }
    }
  }

  // --- Операции позиционирования ---

  /**
   * Исключает дублирующиеся операции на один `id` в одном batch: при
   * мультивыделении контейнера вместе с его ребёнком ребёнок может оказаться
   * и в direct patch, и в cascade — оставляем последнюю (авторитетную) запись.
   */
  function dedupPatchOps(ops: BoardOp[]): BoardOp[] {
    const seen = new Map<string, BoardOp>();
    for (const op of ops) {
      const key = op.type === 'item.patch' ? op.id : op.clientOpId;
      seen.set(key, op);
    }
    return [...seen.values()];
  }

  /**
   * Позиционный патч + cascade-патчи для одного узла. Promise от applyOps
   * намеренно не дожидаемся — drag должен быть плавным, а оптимизм уже
   * применяется локально Vue Flow.
   */
  function sendPositionPatch(
    node: BoardDragNode,
    opts: BoardApplyOptions = {},
    /** Задан — узел на dragStop сменил родителя (drag-in/out фрейма, 14.3) */
    parentId?: string | null,
  ): void {
    const patch: BoardItemPatchOp['patch'] = {
      x: node.computedPosition.x,
      y: node.computedPosition.y,
    };
    if (parentId !== undefined) patch.parentId = parentId;
    const ops: BoardOp[] = [
      { type: 'item.patch', clientOpId: uuid(), id: node.id, patch },
      ...dragCascadeOps(node).ops,
    ];
    void applyOps(dedupPatchOps(ops), opts);
  }

  // --- Обработчики Vue Flow ---

  function onNodeDragStart({ nodes: dragged }: BoardDragEvent): void {
    if (!canEdit()) return;
    breakFollowOnEdit();
    for (const node of dragged) {
      dragStartPositions.set(node.id, { x: node.computedPosition.x, y: node.computedPosition.y });
      // Спутники драга (дети контейнера ИЛИ соседи по группе, 14.3) не входят в
      // event.nodes — засеваем их стартовые позиции здесь же, иначе дельту
      // сдвига не от чего было бы посчитать на драге/dragStop
      for (const mate of dragFamilyOf(node.data)) {
        dragStartPositions.set(mate.id, { x: mate.x, y: mate.y });
      }
    }
    isDragging.value = true;
  }

  function onNodeDrag(event: BoardDragEvent): void {
    if (!canEdit()) return;
    applyAxisLock(event);
    updateSnapGuides(event);
    // Во время драга узла реальный mousemove на пейне не долетает до cursorThrottler
    // (указатель перехвачен драгом Vue Flow) — Canvas оборачивает onNodeDrag и
    // вызывает cursorThrottler сам, поэтому здесь этого нет.
    for (const node of event.nodes) {
      let send = dragThrottlers.get(node.id);
      if (!send) {
        // record: false — промежуточные тики жеста не попадают в историю undo/redo,
        // иначе одна отмена откатывала бы только последние ~80мс драга, а не перенос целиком.
        send = throttle(
          (n: BoardDragNode) => sendPositionPatch(n, { record: false }),
          BOARD_DRAG_THROTTLE_MS,
        );
        dragThrottlers.set(node.id, send);
      }
      send(node);
    }
  }

  function onNodeDragStop(event: BoardDragEvent): void {
    if (!canEdit()) return;
    applyAxisLock(event);
    applySnapPosition(event);
    activeSnapGuides.value = [];
    for (const node of event.nodes) {
      const start = dragStartPositions.get(node.id);
      const moved =
        !start || start.x !== node.computedPosition.x || start.y !== node.computedPosition.y;
      // Отпустили верхнеуровневый элемент внутри границ фрейма/группы — «приклеиваем»
      // его к ней (Miro-семантика, 14.3), см. resolveDragParent
      const nextParentId = resolveDragParent(node);
      const parentChanged = nextParentId !== node.data.parentId;
      // Инверсия — стартовая позиция ВСЕГО жеста (12.10), не позиция перед этим
      // конкретным финальным патчем. Если сменился родитель — откатываем и его тоже,
      // иначе Ctrl+Z вернул бы позицию, но оставил элемент приклеенным к фрейму.
      const mateInverse = dragCascadeOps(node).inverse;
      const inverse: BoardOp[] | undefined = start
        ? [
            {
              type: 'item.patch',
              clientOpId: uuid(),
              id: node.id,
              patch: {
                x: start.x,
                y: start.y,
                ...(parentChanged ? { parentId: node.data.parentId } : {}),
              },
            },
            ...mateInverse,
          ]
        : undefined;
      sendPositionPatch(
        node,
        { record: moved || parentChanged, inverse },
        parentChanged ? nextParentId : undefined,
      );
      // Финальная позиция уже отправлена напрямую выше; trailing промежуточного
      // throttle после неё был бы лишним batch без history и мог бы прийти в
      // сокет позже финальной undo-записи.
      dragThrottlers.get(node.id)?.cancel();
      dragThrottlers.delete(node.id);
      dragStartPositions.delete(node.id);
      for (const mate of dragFamilyOf(node.data)) dragStartPositions.delete(mate.id);
    }
    isDragging.value = false;
  }

  /**
   * Очищает guides, стартовые позиции и throttlers; отменяет все trailing-вызовы
   * (чтобы throttled-патч не прилетел на уже другую доску после смены/размонта).
   * Идемпотентен.
   */
  function reset(): void {
    activeSnapGuides.value = [];
    for (const throttler of dragThrottlers.values()) {
      throttler.cancel();
    }
    dragThrottlers.clear();
    dragStartPositions.clear();
    isDragging.value = false;
  }

  return {
    activeSnapGuides,
    isDragging,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    reset,
  };
}
