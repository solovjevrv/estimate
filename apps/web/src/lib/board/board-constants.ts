/** Общие константы модуля досок — вынесены из магических чисел в BoardCanvas.vue и board-op-history.ts */
import { BOARD_ITEM_MAX_SIZE } from '@poker/shared';

/** Интервал throttle-патчей позиции при драге (мс) */
export const BOARD_DRAG_THROTTLE_MS = 80;

/** Смещение дубликата элемента при вставке рядом с оригиналом (px) */
export const BOARD_DUPLICATE_OFFSET = 24;

/** Через 100 записей самые старые вытесняются — долгая сессия не растит стек undo/redo бесконечно */
export const BOARD_HISTORY_LIMIT = 100;

/** Интервал throttle-рассылки позиции курсора (мс) */
export const BOARD_CURSOR_THROTTLE_MS = 80;

/** Дефолтные размеры фрейма (14.3) — достаточно вместительно, чтобы сразу
 * помещался контент, а заголовок был виден. Группа — тот же размер, но без
 * заливки/рамки (рендерится невидимо, лишь как контейнер для детей). */
export const FRAME_DEFAULT_WIDTH = 640;
export const FRAME_DEFAULT_HEIGHT = 400;
/** Минимум — чтобы фрейм всё равно можно было "поймать" мышью */
export const FRAME_MIN_WIDTH = 160;
export const FRAME_MIN_HEIGHT = 120;
/**
 * Максимум — в отличие от стикера/фигуры (у тех тесный UX-лимит уместен, это
 * карточки с текстом), фрейм — контейнер под произвольный объём контента, и
 * пользователь должен иметь возможность растянуть его настолько, насколько
 * нужно (найдено вручную: 1200 ощущалось искусственно тесным). Единственная
 * реальная граница — `BOARD_ITEM_MAX_SIZE` на сервере (packages/shared),
 * дублируем то же число здесь, а не искусственно занижаем его на клиенте.
 */
export const FRAME_MAX_WIDTH = BOARD_ITEM_MAX_SIZE;
export const FRAME_MAX_HEIGHT = BOARD_ITEM_MAX_SIZE;
