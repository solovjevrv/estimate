/**
 * Значения по умолчанию и границы для создания/резайза стикеров (12.6) —
 * держим их отдельно от компонентов, чтобы холст и тулбар их не дублировали.
 */
import type { BoardColorHex, BoardFontFamily, BoardItemContent } from '@poker/shared';

import { theme } from '../../../lib/theme';

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

/**
 * Текстовый элемент (13.1) — без фона/заливки/рамки, auto-width по содержимому.
 * Дефолтные размеры для создания: минимальный удобный бокс.
 * Границы резайза — те же, что у стикера/фигуры.
 */
export const TEXT_DEFAULT_WIDTH = 200;
export const TEXT_DEFAULT_HEIGHT = 40;
export const TEXT_MIN_WIDTH = STICKY_MIN_WIDTH;
export const TEXT_MIN_HEIGHT = STICKY_MIN_HEIGHT;
export const TEXT_MAX_WIDTH = STICKY_MAX_WIDTH;
export const TEXT_MAX_HEIGHT = STICKY_MAX_HEIGHT;

/** Дефолтный бокс для создания элемента по типу контента — картинка/эмодзи/стикер создаются со своим размером отдельно (см. их composable/обработчик), сюда не входят */
export function textDefaultDimensions(
  content: BoardItemContent,
): { width: number; height: number } | null {
  switch (content.type) {
    case 'sticky':
      return { width: STICKY_DEFAULT_WIDTH, height: STICKY_DEFAULT_HEIGHT };
    case 'shape':
      return { width: SHAPE_DEFAULT_WIDTH, height: SHAPE_DEFAULT_HEIGHT };
    case 'text':
      return { width: TEXT_DEFAULT_WIDTH, height: TEXT_DEFAULT_HEIGHT };
    default:
      return null;
  }
}

/**
 * Картинка на доске (13.2) — сохраняет пропорции исходника, дефолтный бокс —
 * 300×200 (подстроится при загрузке). Границы резайза — те же UX-лимиты.
 */
export const IMAGE_DEFAULT_WIDTH = 300;
export const IMAGE_DEFAULT_HEIGHT = 200;
export const IMAGE_MIN_WIDTH = STICKY_MIN_WIDTH;
export const IMAGE_MIN_HEIGHT = STICKY_MIN_HEIGHT;
export const IMAGE_MAX_WIDTH = STICKY_MAX_WIDTH;
export const IMAGE_MAX_HEIGHT = STICKY_MAX_HEIGHT;

/**
 * Эмодзи на доске (13.3) — просто большой unicode-символ, без фона/заливки.
 * Отдельного поля размера шрифта в контенте нет — символ всегда занимает
 * `EMOJI_FONT_SIZE_RATIO` от меньшей стороны бокса (см. `BoardEmojiNode.vue`),
 * так резайз хендлами (как у картинки) — единственный и работающий способ
 * изменить видимый размер, а не мёртвый параметр рядом с реальным размером бокса.
 */
export const EMOJI_DEFAULT_WIDTH = 120;
export const EMOJI_DEFAULT_HEIGHT = 120;
export const EMOJI_FONT_SIZE_RATIO = 0.6;
/** Ниже, чем у стикера/фигуры (96) — символ сам по себе читаем и мельче (решение пользователя) */
export const EMOJI_MIN_WIDTH = 48;
export const EMOJI_MIN_HEIGHT = 48;
export const EMOJI_MAX_WIDTH = STICKY_MAX_WIDTH;
export const EMOJI_MAX_HEIGHT = STICKY_MAX_HEIGHT;

/**
 * Стикер на доске (13.4) — векторное/растровое изображение из фиксированного набора паков,
 * без фона/заливки. Рендерится как `<img>` с `object-contain` + `keep-aspect-ratio` на ресайзере.
 * Дефолтный размер — 120×120 (как у эмодзи), границы резайза — те же UX-лимиты.
 */
export const STICKER_DEFAULT_WIDTH = 120;
export const STICKER_DEFAULT_HEIGHT = 120;
export const STICKER_MIN_WIDTH = 48; // как у эмодзи — стикер читаем и мельче
export const STICKER_MIN_HEIGHT = 48;
export const STICKER_MAX_WIDTH = STICKY_MAX_WIDTH;
export const STICKER_MAX_HEIGHT = STICKY_MAX_HEIGHT;

/**
 * Вписывает исходный размер картинки в дефолтный бокс 300×200, сохраняя
 * пропорции и никогда не увеличивая (только уменьшает большие исходники) —
 * иначе новый элемент вставал бы на холст размером до 2048px (сервер режет
 * загрузку по этой стороне) и был бы во много раз крупнее стикеров/фигур.
 */
export function fitImageToDefaultBox(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const scale = Math.min(1, IMAGE_DEFAULT_WIDTH / sourceWidth, IMAGE_DEFAULT_HEIGHT / sourceHeight);
  return { width: Math.round(sourceWidth * scale), height: Math.round(sourceHeight * scale) };
}

/**
 * `{ zIndex: number }` вместо конкретно `BoardItem` (12.21) — карточки и связи
 * делят одно пространство порядка (`BoardEdge.zIndex`), поэтому вызывающий
 * код может передать сюда смешанный массив `[...items, ...edges]`, когда нужно
 * учитывать оба типа (передний/задний план связи), а не только карточки.
 */
interface ZIndexed {
  zIndex: number;
}

/** На единицу выше текущего максимума — новый элемент встаёт поверх всех существующих */
export function nextZIndexAbove(elements: readonly ZIndexed[]): number {
  return elements.reduce((max, el) => Math.max(max, el.zIndex), 0) + 1;
}

export function minZIndex(elements: readonly ZIndexed[]): number {
  return elements.reduce((min, el) => Math.min(min, el.zIndex), 0);
}

export function maxZIndex(elements: readonly ZIndexed[]): number {
  return elements.reduce((max, el) => Math.max(max, el.zIndex), 0);
}

/**
 * Сохраняет прежнюю baseline-семантику: максимум не ниже 0, минимум не выше 0.
 * Карточки и связи делят одно пространство порядка (12.21) — вызывающий код
 * передаёт сюда смешанный массив `[...items, ...edges]`, чтобы «на передний/
 * задний план» для связи или карточки учитывало оба типа, а не только один.
 * Используется и в `useBoardSelection` (bring/send для выделения), и в
 * `useBoardEdges` (дефолтный zIndex новой связи при создании).
 */
export function zIndexRange(elements: readonly ZIndexed[]): { max: number; min: number } {
  return { max: maxZIndex(elements), min: minZIndex(elements) };
}
