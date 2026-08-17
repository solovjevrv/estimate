/**
 * Единственное место, где домен доски (`BoardItem`/`BoardEdge`) встречается
 * с типами Vue Flow (`Node`/`Edge`) — если холст когда-нибудь сменится
 * (см. риски в PROGRESS.md), меняется только этот файл.
 */
import type { BoardColorHex, BoardEdge, BoardEdgeMarker, BoardItem } from '@poker/shared';
import {
  MarkerType,
  type Edge,
  type EdgeMarkerType,
  type GraphEdge,
  type GraphNode,
  type Node,
} from '@vue-flow/core';

import { resolveEdgeColor } from './board-item-defaults';

/**
 * Типы узлов/связей Vue Flow с нашими доменными данными — единственная точка
 * соприкосновения типов Vue Flow с доменной моделью доски (см. заголовок файла).
 *
 * Используем `GraphNode`/`GraphEdge` (а не базовые `Node`/`Edge`) — только у
 * расширенных типов есть `computedPosition`/`dimensions`/`selected`, которые
 * требуются selectable-логике и live-превью. `GraphNode.data` требательнее `Node.data?`:
 * обязательный `data: BoardItem`, поэтому в composable не нужно ни о чём гадать.
 */
export type BoardSelectionNode = GraphNode<BoardItem>;
export type BoardSelectionEdge = GraphEdge<BoardEdge>;

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
  // Топологическая сортировка по parentId: сначала узлы без родителя, потом
  // дочерние — глубина ограничена одним уровнем (вложенность запрещена сервером).
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
    style: { stroke: color, strokeWidth: 2 },
    markerStart: toFlowMarkerType(edge.style.markerStart, color),
    markerEnd: toFlowMarkerType(edge.style.markerEnd, color),
    data: edge,
  };
}

export function toFlowEdges(edges: readonly BoardEdge[]): Edge<BoardEdge>[] {
  return edges.map(boardEdgeToFlowEdge);
}
