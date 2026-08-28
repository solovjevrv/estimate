/**
 * Направляющие и выравнивание при перетаскивании (13.6).
 *
 * Чистые функции без зависимостей Vue — покрываются unit-тестами в
 * board-snap.test.ts. Все координаты в canvas-пространстве (flow space),
 * а не в пикселях экрана: порог притягивания (`threshold`) тоже в canvas-
 * координатах, вызывающий код переводит скриншотный порог через
 * `SNAP_THRESHOLD_PX / viewport.zoom`.
 *
 * Алгоритм snap: для каждого перетаскиваемого элемента сравниваем три
 * точки по каждой оси (лево/центр/право для X, верх/центр/низ для Y) с
 * теми же трёх точками у статичных (не перетаскиваемых) элементов. Если
 * расстояние между одинаковыми точками меньше порога — притягиваем. Только
 * same-type: лево к левому, центр к центру, право к правому — это предсказуемо
 * и не создаёт шумных ложных срабатываний (как «лево к правому» вблизи другого
 * элемента).
 */

/** Порог притягивания в пикселях экрана (переводится в canvas координаты вызывающим кодом) */
export const SNAP_THRESHOLD_PX = 8;

export type SnapAlignKeyX = 'left' | 'center' | 'right';
export type SnapAlignKeyY = 'top' | 'center' | 'bottom';

const X_KEYS: readonly SnapAlignKeyX[] = ['left', 'center', 'right'];
const Y_KEYS: readonly SnapAlignKeyY[] = ['top', 'center', 'bottom'];

/** Все точки имеют одинаковый приоритет: при равных расстояниях выбирается
 * первая в массиве (left/top), что позволяет snap по краям работать для
 * одинаковых элементов (иначе центр всегда «перекрывал» краевые линии).
 * Строгое неравенство `diff < best...Diff` в цикле ниже само даёт этот
 * порядок — отдельный механизм приоритетов не нужен. */

/** Прямоугольник элемента в canvas-координатах */
export interface SnapRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapGuide {
  /** 'vertical' — вертикальная линия (x = position), 'horizontal' — горизонтальная (y = position) */
  orientation: 'vertical' | 'horizontal';
  /** Координата направляющей в canvas-пространстве */
  position: number;
  /** Id статичных элементов, к которым притянулась направляющая */
  targetIds: string[];
  /** Координата начала линии вдоль оси (canvas-координата) */
  from: number;
  /** Координата конца линии вдоль оси (canvas-координата) */
  to: number;
}

export interface SnapResult {
  guides: SnapGuide[];
  /** Новые позиции (x/y) только для снапнутых узлов; узлы без снапа не попадают в карту */
  positions: Map<string, { x: number; y: number }>;
}

/** Внутреннее состояние накопления направляющей: target IDs + диапазон линии */
interface GuideState {
  targetIds: Set<string>;
  from: number;
  to: number;
}

function xOf(rect: SnapRect, key: SnapAlignKeyX): number {
  switch (key) {
    case 'left':
      return rect.x;
    case 'center':
      return rect.x + rect.width / 2;
    case 'right':
      return rect.x + rect.width;
  }
}

function yOf(rect: SnapRect, key: SnapAlignKeyY): number {
  switch (key) {
    case 'top':
      return rect.y;
    case 'center':
      return rect.y + rect.height / 2;
    case 'bottom':
      return rect.y + rect.height;
  }
}

/**
 * Округляет позицию направляющей для дедупликации (избегаем двух гидов
 * на 100.0001 и 100.0002 от плавающей арифметики)
 */
function guideKey(pos: number): number {
  return Math.round(pos * 10) / 10;
}

/**
 * Вычисляет snap guides и скорректированные позиции для перетаскиваемых
 * элементов. Каждый перетаскиваемый элемент может притянуться к лучшей
 * (ближайшей) точке у статичных элементов по каждой оси независимо.
 *
 * @param dragged Перетаскиваемые элементы с текущими позициями
 * @param staticNodes Статичные (неперетаскиваемые) элементы
 * @param threshold Порог в canvas-координатах
 */
/**
 * Добавляет/расширяет направляющую в карте по её позиции — общая логика,
 * иначе повторялась бы четыре раза (X/Y × «нашедший сдвиг» проход/«двусторонний»
 * проход из 22.5 ниже). `crossA`/`crossB` — диапазон вдоль оси, перпендикулярной
 * направляющей (Y для вертикальной линии, X для горизонтальной), для рамки d и
 * цели соответственно.
 */
function accumulateGuide(
  map: Map<number, GuideState>,
  position: number,
  sourceId: string,
  crossA: readonly [number, number],
  crossB: readonly [number, number],
): void {
  const from = Math.min(crossA[0], crossA[1], crossB[0], crossB[1]);
  const to = Math.max(crossA[0], crossA[1], crossB[0], crossB[1]);
  const key = guideKey(position);
  const existing = map.get(key);
  if (existing) {
    existing.targetIds.add(sourceId);
    existing.from = Math.min(existing.from, from);
    existing.to = Math.max(existing.to, to);
  } else {
    map.set(key, { targetIds: new Set([sourceId]), from, to });
  }
}

export function computeSnapGuides(
  dragged: SnapRect[],
  staticNodes: SnapRect[],
  threshold = SNAP_THRESHOLD_PX,
): SnapResult {
  const positions = new Map<string, { x: number; y: number }>();
  const vGuides = new Map<number, GuideState>(); // canvas x -> guide state
  const hGuides = new Map<number, GuideState>(); // canvas y -> guide state

  for (const d of dragged) {
    // --- X axis: сначала находим ЛУЧШЕЕ совпадение — оно определяет сдвиг ---
    let bestXDiff = Infinity;
    let snapX: number | null = null;

    for (const s of staticNodes) {
      if (s.id === d.id) continue;
      for (const xKey of X_KEYS) {
        const diff = Math.abs(xOf(d, xKey) - xOf(s, xKey));
        if (diff < threshold && diff < bestXDiff) {
          bestXDiff = diff;
          // Сдвигаем d так, чтобы её xKey совпала с sVal: newX = sVal - (xOf(d, xKey) - d.x)
          snapX = xOf(s, xKey) - (xOf(d, xKey) - d.x);
        }
      }
    }

    // --- Y axis: аналогично ---
    let bestYDiff = Infinity;
    let snapY: number | null = null;

    for (const s of staticNodes) {
      if (s.id === d.id) continue;
      for (const yKey of Y_KEYS) {
        const diff = Math.abs(yOf(d, yKey) - yOf(s, yKey));
        if (diff < threshold && diff < bestYDiff) {
          bestYDiff = diff;
          snapY = yOf(s, yKey) - (yOf(d, yKey) - d.y);
        }
      }
    }

    if (snapX !== null || snapY !== null) {
      positions.set(d.id, { x: snapX ?? d.x, y: snapY ?? d.y });
    }

    // Двусторонняя подсветка (22.5, найдено пользователем при использовании 22.3):
    // после применения сдвига элемент мог оказаться выровненным СРАЗУ по нескольким
    // точкам оси (например, left/left И right/right одновременно — размеры совпали
    // с соседом), а не только по той точке, что определила сам сдвиг. Раньше
    // показывалась только она; второй проход по УЖЕ СКОРРЕКТИРОВАННОЙ позиции
    // находит ВСЕ такие совпадения и добавляет гид на каждое.
    if (snapX !== null) {
      const correctedD = { ...d, x: snapX };
      for (const s of staticNodes) {
        if (s.id === d.id) continue;
        for (const xKey of X_KEYS) {
          const sVal = xOf(s, xKey);
          if (Math.abs(xOf(correctedD, xKey) - sVal) < threshold) {
            accumulateGuide(vGuides, sVal, s.id, [d.y, d.y + d.height], [s.y, s.y + s.height]);
          }
        }
      }
    }
    if (snapY !== null) {
      const correctedD = { ...d, y: snapY };
      for (const s of staticNodes) {
        if (s.id === d.id) continue;
        for (const yKey of Y_KEYS) {
          const sVal = yOf(s, yKey);
          if (Math.abs(yOf(correctedD, yKey) - sVal) < threshold) {
            accumulateGuide(hGuides, sVal, s.id, [d.x, d.x + d.width], [s.x, s.x + s.width]);
          }
        }
      }
    }
  }

  const guides: SnapGuide[] = [];
  for (const [pos, state] of vGuides) {
    guides.push({
      orientation: 'vertical',
      position: pos,
      targetIds: [...state.targetIds],
      from: state.from,
      to: state.to,
    });
  }
  for (const [pos, state] of hGuides) {
    guides.push({
      orientation: 'horizontal',
      position: pos,
      targetIds: [...state.targetIds],
      from: state.from,
      to: state.to,
    });
  }

  return { guides, positions };
}

/**
 * Направляющие и выравнивание при изменении размера (22.3) — в отличие от
 * `computeSnapGuides` (перемещение целиком, три ключа на элемент — лево/центр/
 * право сравниваются СВОИМИ ЖЕ ключами у статичных), при resize подвижен
 * только КОНКРЕТНЫЙ край, который тянет пользователь. Подвижный край
 * сравнивается со ВСЕМИ тремя точками (лево/центр/право или верх/центр/низ)
 * каждого статичного элемента — выровнять правый край растягиваемой фигуры по
 * центру соседней так же осмысленно, как и по её левому/правому краю (в
 * отличие от drag, здесь нет симметричного «свой ключ ищет тот же ключ»).
 *
 * `lockAspectRatio` (стикер/картинка/эмодзи/стикер-пак/GIF — фиксированное
 * соотношение сторон, `keep-aspect-ratio` у `NodeResizer`): обе стороны
 * меняются синхронно, поэтому независимый снап по X и по Y одновременно
 * исказил бы пропорцию рассинхроном с тем, что уже отрисовал сам ресайзер.
 * Если совпадения нашлись на обеих осях сразу — оставляем только более
 * точное (меньше diff), вторую сторону пересчитываем от актуального
 * соотношения `width/height`, а не от независимого совпадения.
 */

/**
 * Какой край активен на каждой оси в этом resize-жесте — НЕ то же самое, что
 * `direction` из `@vue-flow/node-resizer` (`ResizeParamsWithDirection`):
 * знак `direction` кодирует РОСТ/СЖАТИЕ размера (`deltaWidth > 0 ? 1 : -1`),
 * лишь дополнительно инвертированный для «левых»/«верхних» хендлов — то есть
 * для одного и того же (неподвижного слева) хендла «right» знак СМЕНИТСЯ
 * между ростом и сжатием, хотя неподвижный край как был левым, так и остался.
 * Использовать знак `direction` как индикатор «какой край подвижен» —
 * баг (найден пользователем 27.08.2026): сжатие через хендл, не меняющий
 * позицию (например, «bottom-right»), давало `direction < 0` и код ошибочно
 * пересчитывал `x`/`y`, будто подвижен левый/верхний край — карточка
 * дёргалась в сторону при каждом уменьшении размера.
 *
 * `invert` — надёжный сигнал, не зависящий от роста/сжатия: сравнение
 * координаты резайзера (`params.x`/`y`, что бы они ни означали — абсолютные
 * или относительно родителя, см. `resizeRectFromOrigin`) с её значением на
 * МОМЕНТ `resizeStart`, до какого-либо движения. Библиотека меняет позицию
 * ТОЛЬКО когда тянут «левый»/«верхний» хендл (см. её исходники) — значит,
 * если координата изменилась хоть раз за жест, значит хендл инвертирующий,
 * и это НЕ зависит от того, растёт итоговый размер или уменьшается.
 * `active` — менялась ли эта ось в этом жесте вообще (по размеру, не по
 * координате): чистое вертикальное перетаскивание не должно предлагать
 * снап по X.
 */
export interface ResizeAxisFlags {
  xActive: boolean;
  invertX: boolean;
  yActive: boolean;
  invertY: boolean;
}

/**
 * Строит `ResizeAxisFlags` из состояния на момент `resizeStart` (`startX`/
 * `startY` — координаты резайзера ДО жеста, что бы они ни означали) и
 * текущего тика (`x`/`y`/`width`/`height` — те же поля события резайза,
 * `origin` — геометрия элемента ДО жеста, `BoardItem.x/y/width/height`,
 * заведомо абсолютная и не меняющаяся до фактического патча на resize-end).
 */
export function resizeAxisFlags(
  startX: number,
  startY: number,
  origin: SnapRect,
  x: number,
  y: number,
  width: number,
  height: number,
): ResizeAxisFlags {
  return {
    xActive: width !== origin.width,
    invertX: x !== startX,
    yActive: height !== origin.height,
    invertY: y !== startY,
  };
}

export interface ResizeSnapOptions {
  lockAspectRatio?: boolean;
}

export interface ResizeSnapResult {
  guides: SnapGuide[];
  rect: SnapRect;
}

interface AxisMatch {
  value: number;
  sourceId: string;
  diff: number;
}

function bestMatchX(
  resizing: SnapRect,
  activeKey: SnapAlignKeyX,
  staticNodes: readonly SnapRect[],
  threshold: number,
): AxisMatch | null {
  const dVal = xOf(resizing, activeKey);
  let best: AxisMatch | null = null;
  for (const s of staticNodes) {
    for (const key of X_KEYS) {
      const diff = Math.abs(dVal - xOf(s, key));
      if (diff < threshold && (!best || diff < best.diff)) {
        best = { value: xOf(s, key), sourceId: s.id, diff };
      }
    }
  }
  return best;
}

function bestMatchY(
  resizing: SnapRect,
  activeKey: SnapAlignKeyY,
  staticNodes: readonly SnapRect[],
  threshold: number,
): AxisMatch | null {
  const dVal = yOf(resizing, activeKey);
  let best: AxisMatch | null = null;
  for (const s of staticNodes) {
    for (const key of Y_KEYS) {
      const diff = Math.abs(dVal - yOf(s, key));
      if (diff < threshold && (!best || diff < best.diff)) {
        best = { value: yOf(s, key), sourceId: s.id, diff };
      }
    }
  }
  return best;
}

/**
 * Устанавливает РАЗМЕР (не координату края) вдоль оси, сохраняя фиксированным
 * тот край, который в этом resize-жесте неподвижен (`invert` — см.
 * `ResizeAxisFlags`) — общая арифметика и для снапа к найденной координате
 * края (вызывающий код сам переводит её в размер), и для пересчёта второй
 * стороны при `lockAspectRatio` (там размер приходит уже готовым, из
 * соотношения).
 */
function resizeAxis(rect: SnapRect, axis: 'x' | 'y', invert: boolean, newSize: number): SnapRect {
  if (axis === 'x') {
    if (invert) {
      const right = rect.x + rect.width;
      return { ...rect, x: right - newSize, width: newSize };
    }
    return { ...rect, width: newSize };
  }
  if (invert) {
    const bottom = rect.y + rect.height;
    return { ...rect, y: bottom - newSize, height: newSize };
  }
  return { ...rect, height: newSize };
}

function makeResizeGuide(
  orientation: 'vertical' | 'horizontal',
  position: number,
  sourceId: string,
  rect: SnapRect,
  staticNodes: readonly SnapRect[],
): SnapGuide {
  const target = staticNodes.find((s) => s.id === sourceId)!;
  const key = guideKey(position);
  if (orientation === 'vertical') {
    return {
      orientation,
      position: key,
      targetIds: [sourceId],
      from: Math.min(rect.y, rect.y + rect.height, target.y, target.y + target.height),
      to: Math.max(rect.y, rect.y + rect.height, target.y, target.y + target.height),
    };
  }
  return {
    orientation,
    position: key,
    targetIds: [sourceId],
    from: Math.min(rect.x, rect.x + rect.width, target.x, target.x + target.width),
    to: Math.max(rect.x, rect.x + rect.width, target.x, target.x + target.width),
  };
}

export function computeResizeSnapGuides(
  resizing: SnapRect,
  flags: ResizeAxisFlags,
  staticNodes: readonly SnapRect[],
  threshold = SNAP_THRESHOLD_PX,
  options: ResizeSnapOptions = {},
): ResizeSnapResult {
  const activeXKey: SnapAlignKeyX | null = flags.xActive
    ? flags.invertX
      ? 'left'
      : 'right'
    : null;
  const activeYKey: SnapAlignKeyY | null = flags.yActive
    ? flags.invertY
      ? 'top'
      : 'bottom'
    : null;

  const xMatch = activeXKey ? bestMatchX(resizing, activeXKey, staticNodes, threshold) : null;
  const yMatch = activeYKey ? bestMatchY(resizing, activeYKey, staticNodes, threshold) : null;

  let useX = xMatch !== null;
  let useY = yMatch !== null;
  if (options.lockAspectRatio && xMatch && yMatch) {
    if (xMatch.diff <= yMatch.diff) useY = false;
    else useX = false;
  }

  let rect = resizing;
  const guides: SnapGuide[] = [];

  if (useX && xMatch && activeXKey) {
    const newWidth =
      activeXKey === 'right' ? xMatch.value - rect.x : rect.x + rect.width - xMatch.value;
    rect = resizeAxis(rect, 'x', flags.invertX, newWidth);
    guides.push(makeResizeGuide('vertical', xMatch.value, xMatch.sourceId, rect, staticNodes));

    // Двусторонняя подсветка (22.5): активный край нашёл совпадение — проверяем,
    // не совпал ли НЕЗАВИСИМО и неподвижный (закреплённый) край с какой-то точкой
    // соседа. Его координата не меняется этим жестом (см. `resizeRectFromOrigin`),
    // поэтому ищем по исходному `resizing`, а не по уже изменённому `rect`. Если
    // оба края что-то нашли — это и есть сигнал «размеры совпали», а не просто
    // выровнялся один край.
    const fixedXKey: SnapAlignKeyX = activeXKey === 'right' ? 'left' : 'right';
    const anchorXMatch = bestMatchX(resizing, fixedXKey, staticNodes, threshold);
    if (anchorXMatch) {
      guides.push(
        makeResizeGuide('vertical', anchorXMatch.value, anchorXMatch.sourceId, rect, staticNodes),
      );
    }
  }
  if (useY && yMatch && activeYKey) {
    const newHeight =
      activeYKey === 'bottom' ? yMatch.value - rect.y : rect.y + rect.height - yMatch.value;
    rect = resizeAxis(rect, 'y', flags.invertY, newHeight);
    guides.push(makeResizeGuide('horizontal', yMatch.value, yMatch.sourceId, rect, staticNodes));

    const fixedYKey: SnapAlignKeyY = activeYKey === 'bottom' ? 'top' : 'bottom';
    const anchorYMatch = bestMatchY(resizing, fixedYKey, staticNodes, threshold);
    if (anchorYMatch) {
      guides.push(
        makeResizeGuide('horizontal', anchorYMatch.value, anchorYMatch.sourceId, rect, staticNodes),
      );
    }
  }

  if (options.lockAspectRatio && (useX || useY) && resizing.width > 0 && resizing.height > 0) {
    const ratio = resizing.width / resizing.height;
    if (useX && !useY) {
      rect = resizeAxis(rect, 'y', flags.invertY, rect.width / ratio);
    } else if (useY && !useX) {
      rect = resizeAxis(rect, 'x', flags.invertX, rect.height * ratio);
    }
  }

  return { guides, rect };
}

/**
 * Равные отступы (gap) между соседними объектами при перемещении (22.6, по
 * референсу Figma) — принципиально другое сравнение, чем `computeSnapGuides`:
 * там сравниваются ТОЧКИ (координаты краёв/центра), здесь — РАССТОЯНИЯ между
 * парами соседних объектов. Два независимых кейса на каждую ось, оба находят
 * ближайших статичных соседей перетаскиваемого элемента по этой оси среди
 * тех, что пересекаются с ним по ПЕРПЕНДИКУЛЯРНОЙ оси (иначе «зазор» — не
 * горизонтальное/вертикальное расстояние, а диагональ, что не имеет смысла
 * показывать пользователю):
 *
 * (a) Зазор перетаскиваемого элемента до соседа совпал с уже существующим
 *     эталонным зазором между ДВУМЯ ДРУГИМИ статичными соседними объектами
 *     где-то ещё на доске (ровно то, что описано в задаче) — подсвечиваются
 *     ОБА зазора (тянущийся и эталонный) с одинаковым числом px.
 * (b) Перетаскиваемый элемент оказался МЕЖДУ двумя статичными соседями и его
 *     зазор до левого/верхнего почти равен зазору до правого/нижнего —
 *     классическое Figma-«распределить поровну». Приоритетнее (a): если
 *     сосед есть с обеих сторон и зазоры уже близки, показываем именно это,
 *     а не случайное совпадение с эталоном где-то на доске.
 *
 * Показывается только ЛУЧШЕЕ (наименьший diff) совпадение на ось на элемент —
 * в отличие от 22.5 (`computeSnapGuides`), где показываются ВСЕ точечные
 * совпадения: точки — компактный визуальный язык (линия), а гэп — линия
 * ЧИСЛОМ (px-лейбл), несколько таких меток одновременно перегружали бы экран.
 *
 * В отличие от `computeSnapGuides`, работает НЕ параллельно, а ПОСЛЕДОВАТЕЛЬНО
 * с ним: composable сначала применяет point-align снап, затем считает гэпы от
 * уже скорректированной позиции — так гэп-снап никогда не «спорит» с
 * align-снапом за одну и ту же ось, а достраивает свободную (см.
 * `use-board-drag-and-snap.ts`).
 */

export interface GapGuide {
  /** 'horizontal' — зазор вдоль оси X (расстояние между left/right краями), 'vertical' — вдоль Y */
  axis: 'horizontal' | 'vertical';
  /** Величина зазора в canvas-координатах, округлённая для лейбла */
  gap: number;
  /** Координата начала зазора вдоль своей оси (canvas) — край одного объекта */
  from: number;
  /** Координата конца зазора вдоль своей оси (canvas) — край другого объекта */
  to: number;
  /** Координата поперечной оси для отрисовки маркера (canvas) — середина пересечения перпендикулярных диапазонов пары */
  cross: number;
}

export interface GapSnapResult {
  guides: GapGuide[];
  /** Новые позиции для перетаскиваемых элементов, зазор которых снапнулся; без снапа элемент не попадает в карту */
  positions: Map<string, { x: number; y: number }>;
}

function overlapsY(a: SnapRect, b: SnapRect): boolean {
  return a.y < b.y + b.height && b.y < a.y + a.height;
}

function overlapsX(a: SnapRect, b: SnapRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width;
}

/** Ближайший сосед по оси X среди `candidates`, пересекающихся с `target` по Y («та же строка») */
function nearestNeighborX(
  target: SnapRect,
  candidates: readonly SnapRect[],
  side: 'left' | 'right',
): SnapRect | null {
  let best: SnapRect | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (c.id === target.id || !overlapsY(target, c)) continue;
    const dist = side === 'left' ? target.x - (c.x + c.width) : c.x - (target.x + target.width);
    if (dist >= 0 && dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

/** Ближайший сосед по оси Y среди `candidates`, пересекающихся с `target` по X («тот же столбец») */
function nearestNeighborY(
  target: SnapRect,
  candidates: readonly SnapRect[],
  side: 'top' | 'bottom',
): SnapRect | null {
  let best: SnapRect | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (c.id === target.id || !overlapsX(target, c)) continue;
    const dist = side === 'top' ? target.y - (c.y + c.height) : c.y - (target.y + target.height);
    if (dist >= 0 && dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

interface ReferenceGap {
  a: SnapRect;
  b: SnapRect;
  gap: number;
}

/** Все существующие зазоры между статичными соседними парами вдоль оси X (одна запись на пару — от левого элемента пары) */
function collectReferenceGapsX(staticNodes: readonly SnapRect[]): ReferenceGap[] {
  const result: ReferenceGap[] = [];
  for (const a of staticNodes) {
    const b = nearestNeighborX(a, staticNodes, 'right');
    if (b) result.push({ a, b, gap: b.x - (a.x + a.width) });
  }
  return result;
}

/** Все существующие зазоры между статичными соседними парами вдоль оси Y */
function collectReferenceGapsY(staticNodes: readonly SnapRect[]): ReferenceGap[] {
  const result: ReferenceGap[] = [];
  for (const a of staticNodes) {
    const b = nearestNeighborY(a, staticNodes, 'bottom');
    if (b) result.push({ a, b, gap: b.y - (a.y + a.height) });
  }
  return result;
}

function gapGuideX(left: SnapRect, right: SnapRect, gap: number): GapGuide {
  return {
    axis: 'horizontal',
    gap: Math.round(gap),
    from: left.x + left.width,
    to: right.x,
    cross: (Math.max(left.y, right.y) + Math.min(left.y + left.height, right.y + right.height)) / 2,
  };
}

function gapGuideY(top: SnapRect, bottom: SnapRect, gap: number): GapGuide {
  return {
    axis: 'vertical',
    gap: Math.round(gap),
    from: top.y + top.height,
    to: bottom.y,
    cross: (Math.max(top.x, bottom.x) + Math.min(top.x + top.width, bottom.x + bottom.width)) / 2,
  };
}

export function computeEqualGapGuides(
  dragged: SnapRect[],
  staticNodes: SnapRect[],
  threshold = SNAP_THRESHOLD_PX,
): GapSnapResult {
  const positions = new Map<string, { x: number; y: number }>();
  const guides: GapGuide[] = [];
  const refGapsX = collectReferenceGapsX(staticNodes);
  const refGapsY = collectReferenceGapsY(staticNodes);

  for (const d of dragged) {
    // --- X axis ---
    const leftX = nearestNeighborX(d, staticNodes, 'left');
    const rightX = nearestNeighborX(d, staticNodes, 'right');
    const gapLeftX = leftX ? d.x - (leftX.x + leftX.width) : null;
    const gapRightX = rightX ? rightX.x - (d.x + d.width) : null;

    let dx: number | null = null;
    const xGuides: GapGuide[] = [];

    if (
      leftX &&
      rightX &&
      gapLeftX !== null &&
      gapRightX !== null &&
      Math.abs(gapLeftX - gapRightX) < threshold
    ) {
      // (b) распределение: d между двумя статичными соседями, зазоры почти равны
      const evenGap = (gapLeftX + gapRightX) / 2;
      dx = leftX.x + leftX.width + evenGap - d.x;
      const movedD = { ...d, x: d.x + dx };
      xGuides.push(gapGuideX(leftX, movedD, evenGap), gapGuideX(movedD, rightX, evenGap));
    } else {
      // (a) сравнение с эталонным зазором где-то ещё на доске
      let best: {
        neighbor: SnapRect;
        side: 'left' | 'right';
        ref: ReferenceGap;
        diff: number;
      } | null = null;
      for (const ref of refGapsX) {
        if (leftX && gapLeftX !== null) {
          const diff = Math.abs(gapLeftX - ref.gap);
          if (diff < threshold && (!best || diff < best.diff)) {
            best = { neighbor: leftX, side: 'left', ref, diff };
          }
        }
        if (rightX && gapRightX !== null) {
          const diff = Math.abs(gapRightX - ref.gap);
          if (diff < threshold && (!best || diff < best.diff)) {
            best = { neighbor: rightX, side: 'right', ref, diff };
          }
        }
      }
      if (best) {
        dx =
          best.side === 'left'
            ? best.neighbor.x + best.neighbor.width + best.ref.gap - d.x
            : best.neighbor.x - best.ref.gap - d.width - d.x;
        const movedD = { ...d, x: d.x + dx };
        xGuides.push(
          best.side === 'left'
            ? gapGuideX(best.neighbor, movedD, best.ref.gap)
            : gapGuideX(movedD, best.neighbor, best.ref.gap),
          gapGuideX(best.ref.a, best.ref.b, best.ref.gap),
        );
      }
    }

    // --- Y axis: то же самое, зеркально X↔Y, width↔height ---
    const topY = nearestNeighborY(d, staticNodes, 'top');
    const bottomY = nearestNeighborY(d, staticNodes, 'bottom');
    const gapTopY = topY ? d.y - (topY.y + topY.height) : null;
    const gapBottomY = bottomY ? bottomY.y - (d.y + d.height) : null;

    let dy: number | null = null;
    const yGuides: GapGuide[] = [];

    if (
      topY &&
      bottomY &&
      gapTopY !== null &&
      gapBottomY !== null &&
      Math.abs(gapTopY - gapBottomY) < threshold
    ) {
      const evenGap = (gapTopY + gapBottomY) / 2;
      dy = topY.y + topY.height + evenGap - d.y;
      const movedD = { ...d, y: d.y + dy };
      yGuides.push(gapGuideY(topY, movedD, evenGap), gapGuideY(movedD, bottomY, evenGap));
    } else {
      let best: {
        neighbor: SnapRect;
        side: 'top' | 'bottom';
        ref: ReferenceGap;
        diff: number;
      } | null = null;
      for (const ref of refGapsY) {
        if (topY && gapTopY !== null) {
          const diff = Math.abs(gapTopY - ref.gap);
          if (diff < threshold && (!best || diff < best.diff)) {
            best = { neighbor: topY, side: 'top', ref, diff };
          }
        }
        if (bottomY && gapBottomY !== null) {
          const diff = Math.abs(gapBottomY - ref.gap);
          if (diff < threshold && (!best || diff < best.diff)) {
            best = { neighbor: bottomY, side: 'bottom', ref, diff };
          }
        }
      }
      if (best) {
        dy =
          best.side === 'top'
            ? best.neighbor.y + best.neighbor.height + best.ref.gap - d.y
            : best.neighbor.y - best.ref.gap - d.height - d.y;
        const movedD = { ...d, y: d.y + dy };
        yGuides.push(
          best.side === 'top'
            ? gapGuideY(best.neighbor, movedD, best.ref.gap)
            : gapGuideY(movedD, best.neighbor, best.ref.gap),
          gapGuideY(best.ref.a, best.ref.b, best.ref.gap),
        );
      }
    }

    if (dx !== null || dy !== null) {
      positions.set(d.id, { x: d.x + (dx ?? 0), y: d.y + (dy ?? 0) });
    }
    guides.push(...xGuides, ...yGuides);
  }

  return { guides, positions };
}

/**
 * Строит АБСОЛЮТНЫЙ прямоугольник по итогам resize-жеста из заведомо
 * абсолютного стартового прямоугольника (`origin` — геометрия элемента ДО
 * жеста, `BoardItem.x/y/width/height`, не меняется до фактического патча на
 * resize-end) и новых `width`/`height` от резайзера — те же `resizeAxis`,
 * что и внутри `computeResizeSnapGuides`.
 *
 * Обязательна для КАЖДОГО вызывающего resize-кода (найдено пользователем
 * 27.08.2026 на элементе внутри фрейма): `@vue-flow/node-resizer` берёт
 * стартовые `x`/`y` из `node.position`, а для дочернего узла (`parentNode`
 * задан) это координаты ОТНОСИТЕЛЬНО родителя, не абсолютные — тогда как
 * домен хранит `x`/`y` АБСОЛЮТНЫМИ ВСЕГДА (см. `vue-flow-adapter.ts`).
 * Патчить `item.x/y` значениями `params.x/y` из события резайза напрямую
 * нельзя: для элемента без родителя это случайно совпадает (родитель ==
 * канвас, относительное == абсолютному), поэтому баг не был замечен раньше,
 * но для ребёнка фрейма/группы это давало абсолютные координаты, случайно
 * съехавшие на позицию родителя, — карточка "улетала" при любом resize.
 * `width`/`height` эта проблема не касается (размер не зависит от системы
 * координат), поэтому они по-прежнему берутся из события резайза как есть —
 * пересчитываем только x/y, от заведомо верного `origin`, используя `invert`
 * из `ResizeAxisFlags` (не знак `direction` резайзера — см. пояснение там же).
 */
export function resizeRectFromOrigin(
  origin: SnapRect,
  width: number,
  height: number,
  flags: ResizeAxisFlags,
): SnapRect {
  let rect = resizeAxis(origin, 'x', flags.invertX, width);
  rect = resizeAxis(rect, 'y', flags.invertY, height);
  return rect;
}
