import type { BoardColorHex, BoardItem, BoardOp } from '@estimate/shared';
import { BOARD_COLOR_PALETTE } from '@estimate/shared';

import { uuid } from '../infrastructure/uuid';
import { findFrameAt } from './board-containers';

/**
 * Раскладка выделения (15.4, Design — секция «Раскладка»): «по голосам» —
 * сеткой по убыванию точек, «по цвету» / «по автору» — фрейм на каждую
 * кучку. Чистые функции без состояния доски: на входе элементы, на выходе
 * операции одним батчем — одна запись undo откатывает раскладку целиком
 * (удаление фрейма не удаляет детей, а отвязывает их, см. board-op-history).
 * Координаты элементов в домене абсолютные, поэтому ребёнку фрейма меняем
 * только `x`/`y`/`parentId`.
 */

export type BoardArrangeMode = 'votes' | 'color' | 'author';

export interface ArrangeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArrangePlan {
  ops: BoardOp[];
  /** Где оказался результат — камера наводится на него */
  bounds: ArrangeRect;
  /** Созданные фреймы — после раскладки выделяются они */
  frameIds: string[];
}

export interface ArrangeGroup {
  key: string;
  title: string;
  items: BoardItem[];
}

/** Промежуток между элементами сетки */
export const ARRANGE_GAP = 24;
/** Сортировка по голосам — столько в ряд, лидер в левом верхнем углу */
export const ARRANGE_SORT_COLUMNS = 5;
/** Внутренний отступ фрейма кучки */
export const ARRANGE_FRAME_PADDING = 24;
/** Между фреймами — шире промежутка сетки: над фреймом его заголовок */
export const ARRANGE_FRAME_GAP = 64;
/** Сортировка голосования по всей доске встаёт правее всего содержимого */
export const ARRANGE_OUTSIDE_OFFSET = 200;

export function boundsOf(items: readonly ArrangeRect[]): ArrangeRect {
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Порядок чтения: сверху вниз, в ряду — слева направо. «Ряд» — по центру
 * элемента с допуском в полвысоты, иначе стикеры одного ряда с разницей в
 * пару пикселей по `y` перемешивались бы.
 */
export function readingOrder(items: readonly BoardItem[]): BoardItem[] {
  const rowOf = (item: BoardItem): number => item.y + item.height / 2;
  return [...items].sort((a, b) => {
    const tolerance = Math.min(a.height, b.height) / 2;
    const dy = rowOf(a) - rowOf(b);
    if (Math.abs(dy) > tolerance) return dy;
    return a.x - b.x;
  });
}

/** По убыванию точек; равные (и без точек) — в порядке чтения */
export function orderByVotes(
  items: readonly BoardItem[],
  totals: ReadonlyMap<string, number>,
): BoardItem[] {
  const reading = readingOrder(items);
  const position = new Map(reading.map((item, index) => [item.id, index]));
  return [...items].sort(
    (a, b) =>
      (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) ||
      (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
  );
}

function cellOf(items: readonly BoardItem[]): { width: number; height: number } {
  return {
    width: Math.max(...items.map((item) => item.width)),
    height: Math.max(...items.map((item) => item.height)),
  };
}

function gridSize(
  count: number,
  columns: number,
  cell: { width: number; height: number },
): { width: number; height: number } {
  const cols = Math.min(columns, count);
  const rows = Math.ceil(count / columns);
  return {
    width: cols * cell.width + (cols - 1) * ARRANGE_GAP,
    height: rows * cell.height + (rows - 1) * ARRANGE_GAP,
  };
}

function cellPosition(
  index: number,
  columns: number,
  cell: { width: number; height: number },
  origin: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: origin.x + (index % columns) * (cell.width + ARRANGE_GAP),
    y: origin.y + Math.floor(index / columns) * (cell.height + ARRANGE_GAP),
  };
}

/**
 * Сетка «по голосам»: элементы уже в нужном порядке. Родитель после
 * переезда — фрейм под новым центром (как при перетаскивании): элемент,
 * уехавший из своего фрейма, не остаётся к нему привязан.
 */
export function sortPlan(input: {
  ordered: readonly BoardItem[];
  origin: { x: number; y: number };
  /** Все элементы доски — для поиска фрейма под новым местом */
  boardItems: readonly BoardItem[];
}): ArrangePlan {
  const { ordered, origin } = input;
  const moving = new Set(ordered.map((item) => item.id));
  const frames = input.boardItems.filter((item) => !moving.has(item.id));
  const cell = cellOf(ordered);
  const ops: BoardOp[] = ordered.map((item, index) => {
    const { x, y } = cellPosition(index, ARRANGE_SORT_COLUMNS, cell, origin);
    const center = { x: x + item.width / 2, y: y + item.height / 2 };
    const parentId = findFrameAt(frames, center)?.id ?? null;
    return { type: 'item.patch', clientOpId: uuid(), id: item.id, patch: { x, y, parentId } };
  });
  const size = gridSize(ordered.length, ARRANGE_SORT_COLUMNS, cell);
  return { ops, bounds: { ...origin, ...size }, frameIds: [] };
}

/** Колонок во фрейме кучки — кучка получается примерно квадратной: 4 → 2×2, 9 → 3×3 */
export function clusterColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

function intersects(a: ArrangeRect, b: ArrangeRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * «По голосам» с учётом фреймов: элемент во фрейме (например, после раскладки
 * по цвету) сортируется внутри своего фрейма — весь фрейм перекладывается
 * сеткой кучки по убыванию точек, фрейм остаётся на месте и при нужде
 * расширяется; иначе элементы уезжали бы из своих фреймов, оставляя их
 * пустыми с устаревшим числом в заголовке. Остальные — сеткой, как
 * `sortPlan`: от `looseOrigin` или на месте; если такая сетка легла бы на
 * фрейм — правее всего задействованного.
 */
export function votesPlan(input: {
  items: readonly BoardItem[];
  totals: ReadonlyMap<string, number>;
  boardItems: readonly BoardItem[];
  looseOrigin?: { x: number; y: number };
}): ArrangePlan {
  const byId = new Map(input.boardItems.map((item) => [item.id, item]));
  const frames = new Map<string, BoardItem>();
  const loose: BoardItem[] = [];
  for (const item of input.items) {
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    if (parent?.content.type === 'frame') frames.set(parent.id, parent);
    else loose.push(item);
  }

  const ops: BoardOp[] = [];
  const rects: ArrangeRect[] = [];
  for (const frame of frames.values()) {
    const ordered = orderByVotes(
      input.boardItems.filter((child) => child.parentId === frame.id),
      input.totals,
    );
    const columns = clusterColumns(ordered.length);
    const cell = cellOf(ordered);
    const grid = gridSize(ordered.length, columns, cell);
    const inner = { x: frame.x + ARRANGE_FRAME_PADDING, y: frame.y + ARRANGE_FRAME_PADDING };
    ordered.forEach((item, index) => {
      const { x, y } = cellPosition(index, columns, cell, inner);
      ops.push({ type: 'item.patch', clientOpId: uuid(), id: item.id, patch: { x, y } });
    });
    const width = Math.max(frame.width, grid.width + ARRANGE_FRAME_PADDING * 2);
    const height = Math.max(frame.height, grid.height + ARRANGE_FRAME_PADDING * 2);
    if (width !== frame.width || height !== frame.height) {
      ops.push({ type: 'item.patch', clientOpId: uuid(), id: frame.id, patch: { width, height } });
    }
    rects.push({ x: frame.x, y: frame.y, width, height });
  }

  if (loose.length) {
    const ordered = orderByVotes(loose, input.totals);
    let origin = input.looseOrigin ?? boundsOf(loose);
    const size = gridSize(ordered.length, ARRANGE_SORT_COLUMNS, cellOf(ordered));
    const boardFrames = input.boardItems.filter((item) => item.content.type === 'frame');
    if (boardFrames.some((frame) => intersects({ ...origin, ...size }, frame))) {
      const taken = boundsOf([...rects, ...loose]);
      origin = { x: taken.x + taken.width + ARRANGE_FRAME_GAP, y: taken.y };
    }
    const plan = sortPlan({
      ordered,
      origin: { x: origin.x, y: origin.y },
      boardItems: input.boardItems,
    });
    ops.push(...plan.ops);
    rects.push(plan.bounds);
  }

  return { ops, bounds: boundsOf(rects), frameIds: [] };
}

/**
 * Кучки во фреймах: фреймы в ряд от `origin`, внутри — сетка в порядке
 * чтения. Фреймы встают позади элементов (`zIndex`), как и созданные вручную.
 * Элементы уже во фреймах сюда не попадают (см. `useBoardArrange`): раскладка
 * поверх готовых кучек делала кашу из стикеров и фреймов.
 */
export function clusterPlan(input: {
  groups: readonly ArrangeGroup[];
  origin: { x: number; y: number };
  frameZIndex: number;
  frameColor: (group: ArrangeGroup) => BoardColorHex;
}): ArrangePlan {
  const ops: BoardOp[] = [];
  const frameIds: string[] = [];
  let cursor = input.origin.x;
  let maxHeight = 0;

  for (const group of input.groups) {
    const items = readingOrder(group.items);
    const columns = clusterColumns(items.length);
    const cell = cellOf(items);
    const grid = gridSize(items.length, columns, cell);
    const frame = {
      x: cursor,
      y: input.origin.y,
      width: grid.width + ARRANGE_FRAME_PADDING * 2,
      height: grid.height + ARRANGE_FRAME_PADDING * 2,
    };
    const frameId = uuid();
    frameIds.push(frameId);
    ops.push({
      type: 'item.create',
      clientOpId: uuid(),
      item: {
        id: frameId,
        parentId: null,
        ...frame,
        rotation: 0,
        zIndex: input.frameZIndex,
        content: { type: 'frame', title: `${group.title} · ${items.length}` },
        style: { color: input.frameColor(group) },
        reactions: [],
      },
    });
    const inner = { x: frame.x + ARRANGE_FRAME_PADDING, y: frame.y + ARRANGE_FRAME_PADDING };
    items.forEach((item, index) => {
      const { x, y } = cellPosition(index, columns, cell, inner);
      ops.push({
        type: 'item.patch',
        clientOpId: uuid(),
        id: item.id,
        patch: { x, y, parentId: frameId },
      });
    });
    cursor += frame.width + ARRANGE_FRAME_GAP;
    maxHeight = Math.max(maxHeight, frame.height);
  }

  return {
    ops,
    bounds: {
      ...input.origin,
      width: cursor - ARRANGE_FRAME_GAP - input.origin.x,
      height: maxHeight,
    },
    frameIds,
  };
}

function paletteIndex(hex: string): number {
  const index = BOARD_COLOR_PALETTE.findIndex((color) => color.toUpperCase() === hex);
  return index === -1 ? BOARD_COLOR_PALETTE.length : index;
}

/** Большие кучки первыми; `tie` — порядок среди равных */
function bySize<T extends ArrangeGroup>(groups: T[], tie: (a: T, b: T) => number): T[] {
  return groups.sort((a, b) => b.items.length - a.items.length || tie(a, b));
}

/**
 * По цвету заливки. Название — из палитры (`colorName` по индексу), цвет вне
 * палитры называется своим hex. Равные по размеру — в порядке палитры.
 */
export function groupByColor(
  items: readonly BoardItem[],
  colorName: (paletteIndex: number) => string,
): ArrangeGroup[] {
  const groups = new Map<string, BoardItem[]>();
  for (const item of items) {
    const key = item.style.color.toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const list = [...groups].map(([key, members]) => {
    const index = paletteIndex(key);
    return {
      key,
      title: index < BOARD_COLOR_PALETTE.length ? colorName(index) : key,
      items: members,
    };
  });
  return bySize(list, (a, b) => paletteIndex(a.key) - paletteIndex(b.key));
}

/** Ключ кучки гостей — у их элементов нет `createdBy` */
export const ARRANGE_GUESTS_KEY = 'guests';

/**
 * По автору (`createdBy`). Гости — одна кучка, всегда последней; автор без
 * имени в справочнике (аккаунт удалён) — `unknownName`.
 */
export function groupByAuthor(
  items: readonly BoardItem[],
  names: ReadonlyMap<string, string>,
  labels: { guests: string; unknownName: string },
): ArrangeGroup[] {
  const groups = new Map<string, BoardItem[]>();
  for (const item of items) {
    const key = item.createdBy ?? ARRANGE_GUESTS_KEY;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const list = [...groups].map(([key, members]) => ({
    key,
    title: key === ARRANGE_GUESTS_KEY ? labels.guests : (names.get(key) ?? labels.unknownName),
    items: members,
  }));
  const guests = list.filter((group) => group.key === ARRANGE_GUESTS_KEY);
  const authors = bySize(
    list.filter((group) => group.key !== ARRANGE_GUESTS_KEY),
    (a, b) => a.title.localeCompare(b.title),
  );
  return [...authors, ...guests];
}
