/**
 * Адаптер — единственная граница между персистентной доменной моделью
 * `BoardItem`/`BoardEdge` и runtime-моделью Vue Flow (`Node`/`Edge`). Если холст
 * когда-нибудь сменится (см. риски в PROGRESS.md), меняются только `boardItemToNode`/
 * `boardEdgeToFlowEdge`/`toFlowNodes`/`toFlowEdges`. Renderer-компоненты
 * (`BoardCanvas.vue`, node-компоненты, `BoardFloatingEdge.vue`) законно используют
 * Vue Flow API напрямую — для них адаптер избавиться неоткуда, а Vue Flow остаётся
 * реализацией рендерера, а не доменной моделью.
 */
import type {
  BoardColorHex,
  BoardEdge,
  BoardEdgeDash,
  BoardEdgeMarker,
  BoardItem,
} from '@poker/shared';
import {
  MarkerType,
  type Edge,
  type EdgeMarkerType,
  type GraphEdge,
  type GraphNode,
  type Node,
} from '@vue-flow/core';

import { resolveEdgeColor } from '../config/board-item-defaults';

/**
 * Типы узлов/связей Vue Flow с нашими доменными данными — единственная точка
 * соприкосновения типов Vue Flow с доменной моделью доски (см. заголовок файла).
 *
 * Используем `GraphNode`/`GraphEdge` (а не базовые `Node`/`Edge`) — только у
 * расширенных типов есть `computedPosition`/`dimensions`/`selected`, которые
 * требуются selectable-логике и live-превью. `GraphNode.data` требательнее `Node.data?`:
 * обязательный `data: BoardItem`, поэтому в composable не нужно ни о чём гадать.
 */
export type BoardFlowNode = GraphNode<BoardItem>;
export type BoardFlowEdge = GraphEdge<BoardEdge>;

// Совместимость с уже влитым 19.29: BoardSelection переименован в BoardFlow,
// но использование в composable selection сохранено — alias не меняет сигнатуру.
export type BoardSelectionNode = BoardFlowNode;
export type BoardSelectionEdge = BoardFlowEdge;

/**
 * Нейтральные структурные типы для слоя drag/snap (composable
 * `use-board-drag-and-snap` + граница `BoardCanvas.vue`). `BoardDragNode`
 * намеренно не импортирует типы Vue Flow: он должен быть структурно совместим
 * с `GraphNode<BoardItem>` (а `BoardCanvas.vue` адаптирует реальный
 * `NodeDragEvent` в `BoardDragEvent`), но не зависеть от неё — чтобы можно было
 * перестроить тесты и логику, не поднимая Vue Flow.
 */
export interface BoardDragNode {
  id: string;
  data: BoardItem;
  position: { x: number; y: number };
  computedPosition: { x: number; y: number };
  dimensions: { width: number; height: number };
}

export interface BoardDragEvent {
  event: Event;
  nodes: BoardDragNode[];
}

export type BoardDragEdge = BoardFlowEdge;

/**
 * `parent` — родительский `BoardItem` (frame/group), если у `item` задан
 * `parentId`. Домен хранит `x`/`y` АБСОЛЮТНЫМИ всегда (см. заголовок файла и
 * `BoardCanvas.vue` — все патчи позиции читают `node.computedPosition`,
 * которую Vue Flow сам считает абсолютной), а вот `Node.position` в Vue Flow
 * трактуется как позиция ОТНОСИТЕЛЬНО родителя, как только задан `parentNode`
 * (`getXYZPos`: `x = computedPosition.x + parentPos.x`). Без вычитания
 * позиции родителя здесь дочерний узел рендерился бы со сдвигом на координаты
 * родителя ДОПОЛНИТЕЛЬНО к своим собственным — визуально "убегал" бы в
 * сторону при любой группировке/помещении во фрейм.
 */
/**
 * `canEdit` (14.4, по умолчанию `true` — не ломает старые вызовы в тестах)
 * задаёт `draggable` явно на каждом узле: `<VueFlow :nodes-draggable>`
 * — это только ДЕФОЛТ, узловое поле `draggable`, если задано, всегда его
 * перебивает. Раньше здесь стояло жёсткое `true` — зритель по ссылке
 * (`view`) мог визуально таскать элементы, хотя сервер такую правку и так
 * отклонял (расхождение локального холста с правдой сервера до отката).
 */
export function boardItemToNode(
  item: BoardItem,
  parent?: BoardItem,
  canEdit = true,
): Node<BoardItem> {
  const position =
    item.parentId !== null && parent
      ? { x: item.x - parent.x, y: item.y - parent.y }
      : { x: item.x, y: item.y };
  const node: Node<BoardItem> = {
    id: item.id,
    type: item.content.type,
    position,
    width: item.width,
    height: item.height,
    // Явный style.width/height, а не только поля width/height (12.7-баг): при
    // интерактивном резайзе @vue-flow/node-resizer сам пишет размер в node.style
    // (updateStyle: true) — оттуда он и рендерится, а наши width/height-поля
    // используются только КАК ФОЛЛБЭК, если style.width ещё не задан. После
    // первого же ручного резайза style.width навсегда перебивал бы любой
    // последующий программный патч (например, принудительный квадрат при
    // конвертации фигуры в стикер), т.к. мы style не передавали и Vue Flow
    // молча оставлял в узле старое значение. Задаём style сами на каждый
    // рендер — тогда данные приложения всегда источник истины для размера.
    style: { width: `${item.width}px`, height: `${item.height}px` },
    zIndex: item.zIndex,
    draggable: canEdit,
    selectable: true,
    data: item,
  };
  // Дочерний элемент фрейма/группы (14.3) — Vue Flow родительский узел
  // задаём через `parentNode` (нужен для правильного пересчёта абсолютной
  // позиции). НЕ задаём `extent: 'parent'` — сознательно НЕ клэмпим ребёнка
  // внутри границ родителя: пользователь должен иметь возможность вытащить
  // элемент драгом ЗА пределы фрейма (Miro-семантика), а не быть навечно
  // заперт в нём физически. Приклеивание/открепление — по факту итоговой
  // позиции на dragStop (см. resolveDragParent/dragCascadeOps в BoardCanvas.vue),
  // не по физическому ограничению драга.
  if (item.parentId !== null) {
    node.parentNode = item.parentId;
  }
  return node;
}

export function toFlowNodes(items: readonly BoardItem[], canEdit = true): Node<BoardItem>[] {
  // Vue Flow должна увидеть родительский узел (frame/group, 14.3) ДО потомков,
  // чтобы `parentNode`/`extent: 'parent'` корректно сработали при `setNodes`.
  // Топологическая сортировка по parentId: `visit` рекурсивно поднимается по
  // всей цепочке родителей, поэтому корректно работает и при вложенности в
  // два уровня (группа-в-фрейме, 14.8) — единственной, что допускает сервер.
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: Node<BoardItem>[] = [];
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const item = byId.get(id);
    if (!item) return;
    if (item.parentId !== null) visit(item.parentId);
    const parent = item.parentId !== null ? byId.get(item.parentId) : undefined;
    result.push(boardItemToNode(item, parent, canEdit));
  }

  for (const item of items) visit(item.id);
  return result;
}

/**
 * 'dot' — не встроенный тип маркера Vue Flow, рисуется вручную в BoardFloatingEdge.
 * `color` передаём явно объектом (а не голым `MarkerType`) — без него Vue Flow красит
 * ВСЕ наконечники одним общим `defaultMarkerColor`, а не цветом конкретной связи
 * (баг, найденный пользователем: наконечник не совпадал по цвету с линией).
 */
function toFlowMarkerType(
  marker: BoardEdgeMarker,
  color: BoardColorHex,
): EdgeMarkerType | undefined {
  return marker === 'arrow' ? { type: MarkerType.ArrowClosed, color } : undefined;
}

const BOARD_EDGE_DASH_ARRAYS: Record<BoardEdgeDash, string | undefined> = {
  solid: undefined,
  dashed: '10 6',
  dotted: '1 6',
};

function resolveEdgeDashStyle(dash: BoardEdgeDash | undefined): Record<string, string> {
  const kind = dash ?? 'solid';
  const strokeDasharray = BOARD_EDGE_DASH_ARRAYS[kind];
  if (!strokeDasharray) return {};
  return kind === 'dotted' ? { strokeDasharray, strokeLinecap: 'round' } : { strokeDasharray };
}

/**
 * `zIndex` — своё персистентное поле связи (12.21), общее пространство порядка
 * с карточками (`BoardItem.zIndex`), не вычисляется на лету. Раньше (в рамках
 * этой же задачи) считался как `max(source.zIndex, target.zIndex) + 1` прямо
 * тут — без явного поля Vue Flow резолвил незаданный `zIndex` связи в 0
 * (`getEdgeZIndex`, дефолт при пустом поле и выключенном `elevateEdgesOnSelect`),
 * а карточки всегда ≥1, поэтому связь ВСЕГДА рисовалась под любой карточкой
 * (для обычной связи незаметно из-за зазора до границы карточки, но самопетля
 * дугой шла прямо над своей же карточкой и пряталась под ней). Вычисленного
 * значения хватало, пока порядок был только «выше своих двух карточек», но
 * не пользовательского управления передним/задним планом — теперь это обычное
 * патчибельное поле, дефолт при создании считает вызывающий код (см.
 * `use-board-edges.ts`, `onConnect`) через тот же `getBoardZIndex`, что и у
 * карточек.
 */
export function boardEdgeToFlowEdge(edge: BoardEdge): Edge<BoardEdge> {
  // Не задан явно (12.9) — резолвится от текущей темы ЭТОГО зрителя, а не
  // хранится (см. resolveEdgeColor) — читает реактивный theme, поэтому
  // toFlowEdges должен вызываться из реактивного контекста (computed/watch)
  const color = resolveEdgeColor(edge.style.color);
  return {
    id: edge.id,
    source: edge.sourceItemId,
    target: edge.targetItemId,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    // Геометрия — фиксированная точка на стороне карточки (см. floating-edge-geometry.ts),
    // не зависит от типа линии — тип линии решает только форму пути, поэтому
    // всегда один кастомный тип (12.8)
    type: 'floating',
    label: edge.label ?? undefined,
    style: { stroke: color, strokeWidth: 2, ...resolveEdgeDashStyle(edge.style.dash) },
    markerStart: toFlowMarkerType(edge.style.markerStart, color),
    markerEnd: toFlowMarkerType(edge.style.markerEnd, color),
    zIndex: edge.zIndex,
    data: edge,
  };
}

export function toFlowEdges(edges: readonly BoardEdge[]): Edge<BoardEdge>[] {
  return edges.map(boardEdgeToFlowEdge);
}
