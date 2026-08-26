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

import { BOARD_DRAG_THROTTLE_MS } from '../../../features/boards/config/board-constants';
import {
  computeResizeSnapGuides,
  computeSnapGuides,
  SNAP_THRESHOLD_PX,
  type ResizeDirection,
  type SnapGuide,
  type SnapRect,
} from '../../../features/boards/domain/board-snap';
import type {
  BoardDragEvent,
  BoardDragNode,
} from '../../../features/boards/adapters/vue-flow-adapter';
import { throttle } from '../../../lib/throttle';
import { uuid } from '../../../features/boards/infrastructure/uuid';

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

  /** См. `BoardResizeSnapContext` в `board-canvas-keys.ts` — тот же `activeSnapGuides`. */
  updateResizeGuides: (
    itemId: string,
    rect: SnapRect,
    direction: ResizeDirection,
    lockAspectRatio: boolean,
  ) => void;
  applyResizeSnap: (
    itemId: string,
    rect: SnapRect,
    direction: ResizeDirection,
    lockAspectRatio: boolean,
  ) => SnapRect;
  clearResizeGuides: () => void;
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

  /**
   * Дети контейнера плюс, если среди них есть вложенная группа (14.8:
   * группа-в-фрейме — единственная разрешённая вложенность), ещё и участники
   * этой группы — иначе при драге фрейма группа сдвинулась бы, а её участники
   * (parentId указывает на группу, не на фрейм) остались бы на месте.
   */
  function descendantsOf(containerId: string): BoardItem[] {
    const direct = childrenOf(containerId);
    const nested = direct.flatMap((child) =>
      child.content.type === 'group' ? childrenOf(child.id) : [],
    );
    return [...direct, ...nested];
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
      return shiftOps(descendantsOf(node.id), dx, dy);
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
   * Родитель, который должен получить перетаскиваемый узел на dragStop (14.3;
   * 14.8 — группа-в-фрейме). Фрейм сам никогда не вкладывается — вложенность
   * «фрейм-в-фрейме» запрещена. Группа МОЖЕТ приклеиться к фрейму: `findFrameAt`
   * ищет только фреймы (см. её doc-комментарий в `BoardCanvas.vue`), поэтому
   * «группа-в-группе» геометрически недостижима даже без отдельной проверки
   * здесь. Участник группы сохраняет текущий parentId — членство жёсткое,
   * меняется только явным «Разгруппировать». Верхнеуровневый элемент, участник
   * фрейма или сама группа — родитель пересчитывается от текущей позиции
   * всегда, чтобы узнать, что элемент/группу вытащили за пределы фрейма.
   */
  function resolveDragParent(node: BoardDragNode): string | null {
    if (node.data.content.type === 'frame') return null;
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
   * Драг УЧАСТНИКА группы сдвигает саму группу как жёсткий пучок (см. ветку
   * `dragCascadeOps` выше), но не проверяет, не должна ли группа целиком
   * приклеиться к фрейму или отклеиться от него по новой позиции (14.8) — без
   * этого приклеить группу к фрейму можно было бы только точным кликом по её
   * невидимому телу, а не обычным перетаскиванием любого участника, что
   * пользователю никак не открывается. Вызывается только на dragStop (не на
   * промежуточных тиках — как и resolveDragParent для обычных элементов),
   * мутирует `cascade.ops`/`cascade.inverse` НА МЕСТЕ, только если parentId
   * группы реально меняется.
   */
  function reattachGroupIfNeeded(
    memberNode: BoardDragNode,
    cascade: { ops: BoardOp[]; inverse: BoardOp[] },
  ): void {
    if (memberNode.data.parentId === null) return;
    const group = getItems().find((candidate) => candidate.id === memberNode.data.parentId);
    if (!group || group.content.type !== 'group') return;
    const memberStart = dragStartPositions.get(memberNode.id);
    if (!memberStart) return;
    const dx = memberNode.computedPosition.x - memberStart.x;
    const dy = memberNode.computedPosition.y - memberStart.y;
    const groupStart = dragStartPositions.get(group.id) ?? { x: group.x, y: group.y };
    const center = {
      x: groupStart.x + dx + group.width / 2,
      y: groupStart.y + dy + group.height / 2,
    };
    const nextParentId = findFrameAt(center, group.id)?.id ?? null;
    if (nextParentId === group.parentId) return;
    const groupPatch = cascade.ops.find(
      (op): op is BoardItemPatchOp => op.type === 'item.patch' && op.id === group.id,
    );
    if (groupPatch) groupPatch.patch.parentId = nextParentId;
    const groupInverse = cascade.inverse.find(
      (op): op is BoardItemPatchOp => op.type === 'item.patch' && op.id === group.id,
    );
    if (groupInverse) groupInverse.patch.parentId = group.parentId;
  }

  /**
   * Все узлы, чью стартовую позицию нужно засеять вместе с самим `node` (14.3;
   * 14.8): дети контейнера (рекурсивно — с учётом вложенной группы) ИЛИ
   * соседи по группе (включая саму группу-обёртку). Без стартовой позиции у
   * участников вложенной группы `dragCascadeOps` считал бы дельту от уже
   * оптимистично сдвинутых координат вместо истинного начала жеста.
   */
  function dragFamilyOf(node: BoardItem): BoardItem[] {
    if (isBoardContainer(node.content.type)) return descendantsOf(node.id);
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

  /**
   * Snap guides при resize (22.3) — узел резайза не знает про соседние узлы
   * (см. `BoardResizeSnapContext`), поэтому холст сам собирает статичные rect'ы
   * (все узлы кроме резайзящегося) и делегирует чистой `computeResizeSnapGuides`.
   * Использует ТОТ ЖЕ `activeSnapGuides`, что и drag — drag и resize взаимно
   * исключают друг друга по времени (нельзя тащить и резайзить один жест).
   */
  function staticRectsExcept(itemId: string): SnapRect[] {
    return getNodes()
      .filter((n) => n.id !== itemId)
      .map(nodeToSnapRect);
  }

  function updateResizeGuides(
    itemId: string,
    rect: SnapRect,
    direction: ResizeDirection,
    lockAspectRatio: boolean,
  ): void {
    const threshold = SNAP_THRESHOLD_PX / Math.max(getZoom(), 0.1);
    const result = computeResizeSnapGuides(rect, direction, staticRectsExcept(itemId), threshold, {
      lockAspectRatio,
    });
    if (!guidesEqual(result.guides, activeSnapGuides.value)) {
      activeSnapGuides.value = result.guides;
    }
  }

  function applyResizeSnap(
    itemId: string,
    rect: SnapRect,
    direction: ResizeDirection,
    lockAspectRatio: boolean,
  ): SnapRect {
    const threshold = SNAP_THRESHOLD_PX / Math.max(getZoom(), 0.1);
    return computeResizeSnapGuides(rect, direction, staticRectsExcept(itemId), threshold, {
      lockAspectRatio,
    }).rect;
  }

  function clearResizeGuides(): void {
    activeSnapGuides.value = [];
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
    /**
     * Готовые cascade-ops (14.8) — на dragStop уже посчитаны один раз снаружи
     * (и, возможно, дополнены `reattachGroupIfNeeded`), пересчитывать заново
     * незачем. Не задано — обычный путь промежуточных throttled тиков.
     */
    cascadeOps?: BoardOp[],
  ): void {
    const patch: BoardItemPatchOp['patch'] = {
      x: node.computedPosition.x,
      y: node.computedPosition.y,
    };
    if (parentId !== undefined) patch.parentId = parentId;
    const ops: BoardOp[] = [
      { type: 'item.patch', clientOpId: uuid(), id: node.id, patch },
      ...(cascadeOps ?? dragCascadeOps(node).ops),
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
      // cascade считаем один раз и переиспользуем — reattachGroupIfNeeded (14.8)
      // может дописать в неё смену parentId самой группы, если тащили её участника
      const cascade = dragCascadeOps(node);
      reattachGroupIfNeeded(node, cascade);
      // Инверсия — стартовая позиция ВСЕГО жеста (12.10), не позиция перед этим
      // конкретным финальным патчем. Если сменился родитель — откатываем и его тоже,
      // иначе Ctrl+Z вернул бы позицию, но оставил элемент приклеенным к фрейму.
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
            ...cascade.inverse,
          ]
        : undefined;
      sendPositionPatch(
        node,
        { record: moved || parentChanged, inverse },
        parentChanged ? nextParentId : undefined,
        cascade.ops,
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
    updateResizeGuides,
    applyResizeSnap,
    clearResizeGuides,
  };
}
