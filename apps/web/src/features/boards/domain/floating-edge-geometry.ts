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

/**
 * Линейная интерполяция между двумя наборами точек крепления (12.19) — сглаживает
 * путь связи при перемещении подключённой карточки ДРУГИМ участником: throttled-патчи
 * позиции (~80мс) без интерполяции давали дискретные скачки, хотя сама карточка уже
 * сглаживается CSS-переходом transform (12.6) — та же цель, но для пути связи CSS
 * transition на SVG `d` ненадёжен (не interpolable без риска расхождения рендера
 * и getPointAtLength между браузерами), поэтому интерполируются сами координаты, а
 * path пересчитывается на каждом кадре в `BoardFloatingEdge.vue`. Стороны крепления
 * (`sourceSide`/`targetSide`) не интерполируются — это дискретный выбор, не непрерывная
 * величина, берутся из `to`.
 */
export function lerpEdgeAnchorParams(
  from: EdgeAnchorParams,
  to: EdgeAnchorParams,
  t: number,
): EdgeAnchorParams {
  return {
    sx: from.sx + (to.sx - from.sx) * t,
    sy: from.sy + (to.sy - from.sy) * t,
    tx: from.tx + (to.tx - from.tx) * t,
    ty: from.ty + (to.ty - from.ty) * t,
    sourceSide: to.sourceSide,
    targetSide: to.targetSide,
  };
}

/**
 * Ближайшая к точке сторона карточки (12.20) — используется при ручном
 * перецеплении конца связи: во время драга курсор редко попадает точно на
 * 10px-хендл, поэтому сторона крепления на карточке-цели определяется
 * геометрией (какая из 4 середин сторон ближе), а не требует точного клика.
 */
export function nearestSide(
  node: EdgeGeometryNode,
  point: { x: number; y: number },
): EdgeAnchorSide {
  const rect = nodeRect(node);
  const sides: EdgeAnchorSide[] = ['top', 'right', 'bottom', 'left'];
  let closest: EdgeAnchorSide = sides[0]!;
  let closestDistance = Infinity;
  for (const side of sides) {
    const mid = sideMidpoint(rect, side);
    const distance = Math.hypot(mid.x - point.x, mid.y - point.y);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = side;
    }
  }
  return closest;
}

/**
 * Точка, сдвинутая на `gap` px НАРУЖУ от точки крепления вдоль стороны
 * карточки (12.20) — Miro-приём: линия связи визуально не касается карточки
 * впритык, а останавливается с небольшим зазором. Раньше зазора не было (сама
 * линия шла точно до границы), а отдельная ручка переподключения смещалась
 * relative к касательной кривой — при заметном изгибе (12.17) ручка визуально
 * «съезжала» с линии, и было неочевидно, что у связи вообще есть точки
 * переподключения (оба нюанса — по репорту пользователя 20.08.2026). Теперь
 * зазор — часть самой отрисовки: сдвигаются точки крепления, которые видит
 * `pathData`, поэтому линия и ручка переподключения совпадают по построению,
 * без отдельной геометрии по касательной.
 */
export function outwardGapPoint(
  anchor: { x: number; y: number },
  side: EdgeAnchorSide,
  gap: number,
): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: anchor.x, y: anchor.y - gap };
    case 'bottom':
      return { x: anchor.x, y: anchor.y + gap };
    case 'left':
      return { x: anchor.x - gap, y: anchor.y };
    case 'right':
      return { x: anchor.x + gap, y: anchor.y };
  }
}

/**
 * Кривая связь (line: 'curved') с пользовательским смещением изгиба (12.17).
 * `curveOffset` — смещение апекса (видимой точки изгиба) от геометрической
 * середины прямой между точками крепления. Чтобы точка на квадратичной
 * Безье при t=0.5 физически совпала с apex, control-point смещён вдвое.
 */
export function getOffsetCurvePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  offset: { x: number; y: number },
): [path: string, labelX: number, labelY: number] {
  const midX = (sx + tx) / 2;
  const midY = (sy + ty) / 2;
  const controlX = midX + offset.x * 2;
  const controlY = midY + offset.y * 2;
  const apexX = midX + offset.x;
  const apexY = midY + offset.y;
  return [`M${sx},${sy} Q${controlX},${controlY} ${tx},${ty}`, apexX, apexY];
}

/**
 * Точка дискретной выборки отрисованного пути связи (12.18) — мировые px
 * канваса, та же система координат, что у sx/sy/tx/ty.
 */
export interface PathSample {
  x: number;
  y: number;
}

/**
 * Ближайшая к целевой точке точка на предвычисленной выборке пути — линейный
 * проход без интерполяции между соседними сэмплами (плотности выборки,
 * задаваемой вызывающим кодом — см. `LABEL_PATH_SAMPLE_COUNT` в
 * `BoardFloatingEdge.vue` — достаточно для интерактивного драга). Возвращает
 * индекс, а не саму точку, чтобы вызывающий код мог сразу получить
 * касательную через `tangentAtSample` тем же индексом.
 *
 * Используется для перетаскивания подписи связи «магнитом» к РЕАЛЬНОЙ
 * отрисованной кривой (12.18) — раньше смещение считалось относительно
 * прямой между точками крепления, что заметно расходилось с видимой формой
 * у сильно изогнутых связей (найдено пользователем при ручной проверке).
 */
export function closestSampleIndex(samples: readonly PathSample[], target: PathSample): number {
  let bestIndex = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    const dx = sample.x - target.x;
    const dy = sample.y - target.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Единичный касательный вектор пути в точке выборки с данным индексом — по
 * соседним сэмплам (центральная разность, где есть оба соседа; иначе
 * односторонняя на границах выборки).
 */
export function tangentAtSample(samples: readonly PathSample[], index: number): PathSample {
  const prev = samples[Math.max(0, index - 1)]!;
  const next = samples[Math.min(samples.length - 1, index + 1)]!;
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

/**
 * Точка, сдвинутая от `point` вдоль нормали к `tangent` на `distance` px.
 * Нормаль — поворот касательной на 90° (`-tangent.y, tangent.x`), тот же
 * знак/ориентация, что и в остальной геометрии связей в этом файле.
 */
export function offsetAlongNormal(
  point: PathSample,
  tangent: PathSample,
  distance: number,
): PathSample {
  return { x: point.x - tangent.y * distance, y: point.y + tangent.x * distance };
}
