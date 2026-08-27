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

/**
 * Интервал throttle-рассылки собственной камеры (14.5) — грубее курсора: пан/зум
 * дают апдейты viewport на каждый кадр драга, курсорная частота (80мс) для этого избыточна
 */
export const BOARD_CAMERA_THROTTLE_MS = 150;

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

/**
 * Шаблоны размера/пропорций фрейма (22.4.2, тулбар иконок-кнопок по референсу
 * Miro) — чисто клиентская таблица, не часть домена: применение шаблона просто
 * патчит `width`/`height` выделенного фрейма (`item.patch`), как обычный ресайз,
 * без отдельного поля-состояния на `BoardItem` (сервер не отличает фрейм,
 * подогнанный под A4, от подогнанного вручную под те же пиксели).
 *
 * `custom` НЕ входит в этот список — в отличие от остальных, это не
 * фиксированный размер, а обозначение «свободная форма» (как в Miro): клик по
 * нему в тулбаре не меняет геометрию, поэтому ему нечего сопоставлять здесь
 * (см. обработку в `BoardSelectionToolbar.vue`/`use-board-selection.ts`).
 *
 * Размеры — логические px канваса при 96dpi-эквиваленте (A4/Letter) либо
 * распространённые эталонные значения (16:9/4:3/телефон/планшет/браузер) —
 * собственный выбор проекта, не выгружены из недокументированного API Miro.
 */
export type FrameSizePresetKey =
  | 'custom'
  | 'a4'
  | 'letter'
  | 'widescreen'
  | 'standard'
  | 'square'
  | 'phone'
  | 'tablet'
  | 'browser';

export interface FrameSizePreset {
  key: Exclude<FrameSizePresetKey, 'custom'>;
  width: number;
  height: number;
}

export const FRAME_SIZE_PRESETS: readonly FrameSizePreset[] = [
  { key: 'a4', width: 794, height: 1123 },
  { key: 'letter', width: 816, height: 1056 },
  { key: 'widescreen', width: 1280, height: 720 },
  { key: 'standard', width: 1024, height: 768 },
  { key: 'square', width: 800, height: 800 },
  { key: 'phone', width: 375, height: 812 },
  { key: 'tablet', width: 768, height: 1024 },
  { key: 'browser', width: 1440, height: 900 },
];
