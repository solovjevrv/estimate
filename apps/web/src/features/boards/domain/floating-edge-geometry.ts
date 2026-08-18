/**
 * Геометрия связи (12.8) — конец цепляется к КОНКРЕТНОЙ выбранной пользователем
 * точке на границе карточки (верх/право/низ/лево — id хендла, который он
 * реально схватил при создании связи), а не пересчитывается на лету к
 * ближайшей стороне. Точка при этом не залипает на месте: пересчитывается по
 * актуальным `computedPosition`/`dimensions` узла на каждый рендер, так что
 * следует за карточкой при её перетаскивании/резайзе, просто не меняет
 * СТОРОНУ. Первая версия (пересечение прямоугольника с линией центров,
 * автовыбор ближайшей стороны) оказалась неудобной на практике — пользователь
 * не мог управлять тем, к какой точке крепится стрелка, и точка "прыгала"
 * при перемещении карточек (решение пользователя 07.08.2026, правки после
 * ручной проверки 12.8).
 *
 * Чистый слой геометрии: не импортирует ни Vue, ни Vue Flow — работает с
 * абстрактными прямоугольниками, чтобы не зависеть от рендерера (см. ТЗ 19.36).
 * Стороны переводятся в `Position` Vue Flow только в renderer-компоненте
 * `BoardFloatingEdge.vue` через `toVueFlowPosition`.
 */

export interface EdgeGeometryNode {
  computedPosition: { x: number; y: number };
  dimensions: { width: number; height: number };
}

export type EdgeAnchorSide = 'top' | 'right' | 'bottom' | 'left';

const DEFAULT_SOURCE_SIDE: EdgeAnchorSide = 'right';
const DEFAULT_TARGET_SIDE: EdgeAnchorSide = 'left';

/** `sourceHandle`/`targetHandle` — общее поле протокола (`string | null`), не обязательно
 * одна из 4 наших сторон (например, чужой клиент) — подстраховка своим фолбэком на роль */
function normalizeSide(
  handleId: string | null | undefined,
  fallback: EdgeAnchorSide,
): EdgeAnchorSide {
  return handleId === 'top' || handleId === 'right' || handleId === 'bottom' || handleId === 'left'
    ? handleId
    : fallback;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function nodeRect(node: EdgeGeometryNode): Rect {
  return {
    x: node.computedPosition.x,
    y: node.computedPosition.y,
    width: node.dimensions.width,
    height: node.dimensions.height,
  };
}

function sideMidpoint(rect: Rect, side: EdgeAnchorSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
}

export interface EdgeAnchorParams {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourceSide: EdgeAnchorSide;
  targetSide: EdgeAnchorSide;
}

export function getEdgeAnchorParams(
  source: EdgeGeometryNode,
  target: EdgeGeometryNode,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): EdgeAnchorParams {
  const sourceSide = normalizeSide(sourceHandle, DEFAULT_SOURCE_SIDE);
  const targetSide = normalizeSide(targetHandle, DEFAULT_TARGET_SIDE);
  const sourcePoint = sideMidpoint(nodeRect(source), sourceSide);
  const targetPoint = sideMidpoint(nodeRect(target), targetSide);

  return {
    sx: sourcePoint.x,
    sy: sourcePoint.y,
    tx: targetPoint.x,
    ty: targetPoint.y,
    sourceSide,
    targetSide,
  };
}
