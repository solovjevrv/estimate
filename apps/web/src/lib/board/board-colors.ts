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
