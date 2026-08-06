/**
 * Значения по умолчанию и границы для создания/резайза стикеров (12.6) —
 * держим их отдельно от компонентов, чтобы холст и тулбар их не дублировали.
 */
import type { BoardColorToken, BoardItem } from '@poker/shared';

export const STICKY_DEFAULT_WIDTH = 200;
export const STICKY_DEFAULT_HEIGHT = 150;
export const STICKY_DEFAULT_COLOR: BoardColorToken = 'yellow';

/** UX-границы резайза — заметно уже серверных (`MAX_SIZE=10000`), сервер всё равно проверит сам */
export const STICKY_MIN_WIDTH = 96;
export const STICKY_MIN_HEIGHT = 72;
export const STICKY_MAX_WIDTH = 1200;
export const STICKY_MAX_HEIGHT = 1200;

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
