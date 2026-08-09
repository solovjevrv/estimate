/**
 * Значения по умолчанию и границы для создания/резайза стикеров (12.6) —
 * держим их отдельно от компонентов, чтобы холст и тулбар их не дублировали.
 */
import type { BoardColorHex, BoardFontFamily, BoardItem } from '@poker/shared';

import { theme } from '../theme';

/**
 * Токен шрифта (12.9) -> CSS-переменная, уже объявленная в `main.css`.
 * Не задан — тело текста как было до 12.9 (`--font-sans`, Manrope).
 */
export function boardFontFamilyCss(fontFamily: BoardFontFamily | undefined): string {
  return fontFamily === 'heading' ? 'var(--font-heading)' : 'var(--font-sans)';
}

/** Стикер — всегда квадрат (12.7): ширина и высота равны и в дефолте, и в границах резайза */
export const STICKY_DEFAULT_WIDTH = 180;
export const STICKY_DEFAULT_HEIGHT = 180;
export const STICKY_DEFAULT_COLOR: BoardColorHex = '#FCEB96';

/** UX-границы резайза — заметно уже серверных (`BOARD_ITEM_MAX_SIZE=10000`), сервер всё равно проверит сам */
export const STICKY_MIN_WIDTH = 96;
export const STICKY_MIN_HEIGHT = 96;
export const STICKY_MAX_WIDTH = 1200;
export const STICKY_MAX_HEIGHT = 1200;

export const SHAPE_DEFAULT_WIDTH = 160;
export const SHAPE_DEFAULT_HEIGHT = 120;
export const SHAPE_DEFAULT_COLOR: BoardColorHex = '#A8CAFF';

/**
 * Цвет стрелки (12.9) — не хранится по умолчанию (`BoardEdgeStyle.color`
 * опционален): если не задан явно, вычисляется здесь заново у КАЖДОГО
 * зрителя от ЕГО ТЕКУЩЕЙ темы, а не фиксируется на теме автора в момент
 * создания. Раньше (12.8) новая стрелка сразу получала литеральный hex
 * (чёрный на светлой теме / белый на тёмной) — это ломалось, как только
 * стрелку смотрел кто-то в противоположной теме: белая стрелка невидима на
 * светлом холсте (баг, найденный пользователем 07.08.2026, разобран и
 * переделан 08.08.2026). Как только пользователь явно выбирает цвет в
 * тулбаре — он фиксируется как обычный hex и с этого момента не зависит от
 * темы ни у кого. Вызывать только из реактивного контекста (computed/watch) —
 * читает глобальный `theme`.
 */
const EDGE_AUTO_COLOR_LIGHT: BoardColorHex = '#1A1A1A';
const EDGE_AUTO_COLOR_DARK: BoardColorHex = '#FFFFFF';

export function resolveEdgeColor(color: BoardColorHex | undefined): BoardColorHex {
  if (color) return color;
  return theme.value === 'dark' ? EDGE_AUTO_COLOR_DARK : EDGE_AUTO_COLOR_LIGHT;
}

/** Те же UX-границы, что у стикера (12.7) — единая логика резайза для всех типов элементов */
export const SHAPE_MIN_WIDTH = STICKY_MIN_WIDTH;
export const SHAPE_MIN_HEIGHT = STICKY_MIN_HEIGHT;
export const SHAPE_MAX_WIDTH = STICKY_MAX_WIDTH;
export const SHAPE_MAX_HEIGHT = STICKY_MAX_HEIGHT;

/** На единицу выше текущего максимума — новый элемент встаёт поверх всех существующих */
export function nextZIndexAbove(items: readonly BoardItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.zIndex), 0) + 1;
}

export function minZIndex(items: readonly BoardItem[]): number {
  return items.reduce((min, item) => Math.min(min, item.zIndex), 0);
}

export function maxZIndex(items: readonly BoardItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.zIndex), 0);
}
