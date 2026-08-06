/**
 * Отображение белого списка цветовых токенов (`BOARD_COLOR_TOKENS`, сервер
 * их же валидирует в `board-ops.ts`) на реальные цвета для рендера — только
 * фронтенд, в общий пакет не выносим, т.к. сервер сам в CSS/HEX не льёт.
 */
import type { BoardColorToken } from '@poker/shared';

export const BOARD_COLOR_HEX: Record<BoardColorToken, string> = {
  yellow: '#f5d90a',
  green: '#8ce99a',
  blue: '#74c0fc',
  pink: '#faa2c1',
  purple: '#d0bfff',
  orange: '#ffc078',
  gray: '#ced4da',
};

export const BOARD_COLOR_CLASSES: Record<BoardColorToken, string> = {
  yellow: 'bg-[#fff3bf] border-[#f5d90a]',
  green: 'bg-[#ebfbee] border-[#8ce99a]',
  blue: 'bg-[#e7f5ff] border-[#74c0fc]',
  pink: 'bg-[#fff0f6] border-[#faa2c1]',
  purple: 'bg-[#f3f0ff] border-[#d0bfff]',
  orange: 'bg-[#fff4e6] border-[#ffc078]',
  gray: 'bg-[#f1f3f5] border-[#ced4da]',
};

/** Только фон, без рамки — стикеры в референсе держатся на тени, а не на обводке (12.6) */
export const BOARD_COLOR_BG_CLASSES: Record<BoardColorToken, string> = {
  yellow: 'bg-[#fff3bf]',
  green: 'bg-[#ebfbee]',
  blue: 'bg-[#e7f5ff]',
  pink: 'bg-[#fff0f6]',
  purple: 'bg-[#f3f0ff]',
  orange: 'bg-[#fff4e6]',
  gray: 'bg-[#f1f3f5]',
};

/** Текст стикера — не чёрный, а затемнённый вариант того же тона (12.6, по референсу) */
export const BOARD_COLOR_TEXT_CLASSES: Record<BoardColorToken, string> = {
  yellow: 'text-[#856404]',
  green: 'text-[#2b8a3e]',
  blue: 'text-[#1864ab]',
  pink: 'text-[#a61e4d]',
  purple: 'text-[#5f3dc4]',
  orange: 'text-[#d9480f]',
  gray: 'text-[#495057]',
};
