/** Общие константы модуля досок — вынесены из магических чисел в BoardCanvas.vue и board-op-history.ts */

/** Интервал throttle-патчей позиции при драге (мс) */
export const BOARD_DRAG_THROTTLE_MS = 80;

/** Смещение дубликата элемента при вставке рядом с оригиналом (px) */
export const BOARD_DUPLICATE_OFFSET = 24;

/** Через 100 записей самые старые вытесняются — долгая сессия не растит стек undo/redo бесконечно */
export const BOARD_HISTORY_LIMIT = 100;
