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
    guides.push({ orientation: 'vertical', position: pos, targetIds: [...state.targetIds], from: state.from, to: state.to });
  }
  for (const [pos, state] of hGuides) {
    guides.push({ orientation: 'horizontal', position: pos, targetIds: [...state.targetIds], from: state.from, to: state.to });
  }

  return { guides, positions };
}
