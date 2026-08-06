/**
 * Единственное место, где домен доски (`BoardItem`/`BoardEdge`) встречается
 * с типами Vue Flow (`Node`/`Edge`) — если холст когда-нибудь сменится
 * (см. риски в PROGRESS.md), меняется только этот файл.
 */
import type { BoardEdge, BoardItem } from '@poker/shared';
import type { Edge, Node } from '@vue-flow/core';

export function boardItemToNode(item: BoardItem): Node<BoardItem> {
  return {
    id: item.id,
    type: item.content.type,
    position: { x: item.x, y: item.y },
    width: item.width,
    height: item.height,
    zIndex: item.zIndex,
    draggable: true,
    selectable: true,
    data: item,
  };
}

export function toFlowNodes(items: readonly BoardItem[]): Node<BoardItem>[] {
  return items.map(boardItemToNode);
}

export function boardEdgeToFlowEdge(edge: BoardEdge): Edge<BoardEdge> {
  return {
    id: edge.id,
    source: edge.sourceItemId,
    target: edge.targetItemId,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    // Floating edges (геометрия до ближайшей стороны) — 12.8; пока прямая или кривая по типу линии
    type: edge.style.line === 'straight' ? 'straight' : 'default',
    label: edge.label ?? undefined,
    style: { stroke: edge.style.color, strokeWidth: 2 },
    data: edge,
  };
}

export function toFlowEdges(edges: readonly BoardEdge[]): Edge<BoardEdge>[] {
  return edges.map(boardEdgeToFlowEdge);
}
