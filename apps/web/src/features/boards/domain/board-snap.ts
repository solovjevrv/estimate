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
export function computeSnapGuides(
  dragged: SnapRect[],
  staticNodes: SnapRect[],
  threshold = SNAP_THRESHOLD_PX,
): SnapResult {
  const positions = new Map<string, { x: number; y: number }>();
  const vGuides = new Map<number, GuideState>(); // canvas x -> guide state
  const hGuides = new Map<number, GuideState>(); // canvas y -> guide state

  for (const d of dragged) {
    // --- X axis ---
    let bestXDiff = Infinity;
    let snapX: number | null = null;
    let snapXGuidePos = 0;
    let snapXSource = '';

    for (const s of staticNodes) {
      if (s.id === d.id) continue;
      for (const xKey of X_KEYS) {
        const dVal = xOf(d, xKey);
        const sVal = xOf(s, xKey);
        const diff = Math.abs(dVal - sVal);
        if (diff < threshold && diff < bestXDiff) {
          bestXDiff = diff;
          snapXGuidePos = sVal;
          snapXSource = s.id;
          // Сдвигаем d так, чтобы её xKey совпала с sVal:
          // newX = sVal - (xOf(d, xKey) - d.x)
          snapX = sVal - (xOf(d, xKey) - d.x);
        }
      }
    }

    // --- Y axis ---
    let bestYDiff = Infinity;
    let snapY: number | null = null;
    let snapYGuidePos = 0;
    let snapYSource = '';

    for (const s of staticNodes) {
      if (s.id === d.id) continue;
      for (const yKey of Y_KEYS) {
        const dVal = yOf(d, yKey);
        const sVal = yOf(s, yKey);
        const diff = Math.abs(dVal - sVal);
        if (diff < threshold && diff < bestYDiff) {
          bestYDiff = diff;
          snapYGuidePos = sVal;
          snapYSource = s.id;
          snapY = sVal - (yOf(d, yKey) - d.y);
        }
      }
    }

    if (snapX !== null || snapY !== null) {
      positions.set(d.id, { x: snapX ?? d.x, y: snapY ?? d.y });
    }

    if (snapX !== null) {
      // Вертикальная линия: from/to по Y — объединённый диапазон rect'ов d и target
      const targetRect = staticNodes.find((n) => n.id === snapXSource);
      const yMin = Math.min(d.y, d.y + d.height, targetRect!.y, targetRect!.y + targetRect!.height);
      const yMax = Math.max(d.y, d.y + d.height, targetRect!.y, targetRect!.y + targetRect!.height);
      const key = guideKey(snapXGuidePos);
      const existing = vGuides.get(key);
      if (existing) {
        existing.targetIds.add(snapXSource);
        existing.from = Math.min(existing.from, yMin);
        existing.to = Math.max(existing.to, yMax);
      } else {
        vGuides.set(key, { targetIds: new Set([snapXSource]), from: yMin, to: yMax });
      }
    }
    if (snapY !== null) {
      const targetRect = staticNodes.find((n) => n.id === snapYSource);
      const xMin = Math.min(d.x, d.x + d.width, targetRect!.x, targetRect!.x + targetRect!.width);
      const xMax = Math.max(d.x, d.x + d.width, targetRect!.x, targetRect!.x + targetRect!.width);
      const key = guideKey(snapYGuidePos);
      const existing = hGuides.get(key);
      if (existing) {
        existing.targetIds.add(snapYSource);
        existing.from = Math.min(existing.from, xMin);
        existing.to = Math.max(existing.to, xMax);
      } else {
        hGuides.set(key, { targetIds: new Set([snapYSource]), from: xMin, to: xMax });
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
  }
  if (useY && yMatch && activeYKey) {
    const newHeight =
      activeYKey === 'bottom' ? yMatch.value - rect.y : rect.y + rect.height - yMatch.value;
    rect = resizeAxis(rect, 'y', flags.invertY, newHeight);
    guides.push(makeResizeGuide('horizontal', yMatch.value, yMatch.sourceId, rect, staticNodes));
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
