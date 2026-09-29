/**
 * Общая механика узлов доски с редактируемым текстом (стикер/фигура, 17.5) —
 * до этого одна и та же связка (цвет/шрифт из `style`, `useRichTextEditing`,
 * авто-fit шрифта через `useFitFontSize`, публикация отрисованного размера в
 * реестр тулбара, `onResizeEnd`) была продублирована почти дословно в
 * `BoardStickyNode.vue` и `BoardShapeNode.vue`. Разница между узлами —
 * форма `content` (`buildContent`) и специфичная геометрия/оформление
 * (ромб/скругление у фигуры, реакции у стикера) — остаётся в самих компонентах.
 */
import {
  BOARD_ITEM_FONT_SIZE_MAX,
  BOARD_ITEM_FONT_SIZE_MIN,
  type BoardItem,
  type BoardItemContent,
  type BoardTextRun,
} from '@estimate/shared';
import { computed, inject, onBeforeUnmount, useTemplateRef, watch, type Ref } from 'vue';

import {
  BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY,
  BOARD_RESIZE_SNAP_KEY,
} from '../context/board-canvas-keys';
import { readableTextColor } from '../domain/board-colors';
import { boardFontFamilyCss } from '../config/board-item-defaults';
import { resizeAxisFlags, resizeRectFromOrigin } from '../domain/board-snap';
import { FIT_FONT_MAX, getScaledFontSize, useFitFontSize } from './use-fit-font-size';
import { useRichTextEditing } from './use-rich-text-editing';
import { useBoardSessionStore } from '../../../stores/board-session';

/**
 * `x`/`y` используются ТОЛЬКО для сравнения с координатой на момент
 * `resizeStart` (детект инвертирующего хендла — `resizeAxisFlags` в
 * `board-snap.ts`), НЕ как позиция для патча напрямую: `@vue-flow/node-resizer`
 * берёт их из `node.position`, которое для дочернего узла (`parentNode`
 * задан) хранит координаты ОТНОСИТЕЛЬНО родителя, а не абсолютные, как того
 * всегда требует домен (см. `resizeRectFromOrigin` — найденный пользователем
 * 27.08.2026 баг: карточка внутри фрейма улетала при resize).
 */
export interface BoardResizeParams {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Координаты резайзера ДО жеста — момент `resizeStart`, точка отсчёта для `resizeAxisFlags`. */
export type BoardResizeStartParams = Pick<BoardResizeParams, 'x' | 'y'>;

export interface UseBoardNodeEditingOptions<TContent extends BoardItemContent & { text: string }> {
  itemId: string;
  /** `props.data` целиком — цвет/шрифт/ширина/высота читаются из него. */
  data: Ref<BoardItem>;
  canEdit: Ref<boolean>;
  /** `props.selected` из Vue Flow — прокидывается в `useRichTextEditing` как есть. */
  isSelected: Ref<boolean>;
  content: Ref<TContent>;
  buildContent: (text: string, runs: BoardTextRun[] | undefined) => TContent;
  /** Стикер всегда квадрат (`keep-aspect-ratio` на `NodeResizer`), фигура — нет (22.3). */
  lockAspectRatio: boolean;
}

export function useBoardNodeEditing<TContent extends BoardItemContent & { text: string }>(
  options: UseBoardNodeEditingOptions<TContent>,
) {
  const { itemId, data, canEdit, isSelected, content, buildContent, lockAspectRatio } = options;
  const boardSession = useBoardSessionStore();
  const effectiveFontSizes = inject(BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY, null);
  const resizeSnap = inject(BOARD_RESIZE_SNAP_KEY, null);

  const bgColor = computed(() => data.value.style.color);
  const textColor = computed(() => data.value.style.textColor ?? readableTextColor(bgColor.value));
  const fontFamily = computed(() => boardFontFamilyCss(data.value.style.fontFamily));
  const textAlign = computed(() => data.value.style.textAlign ?? 'center');
  const baseFontSize = computed(() => data.value.style.fontSize ?? FIT_FONT_MAX);
  const fontSizeMode = computed(() => data.value.style.fontSizeMode ?? 'auto');

  // `ref="contentBox"`/`ref="text"` в шаблоне вызывающего компонента — как и
  // `ref="editable"` внутри useRichTextEditing, регистрация template ref
  // привязана к текущему инстансу компонента, а не лексически к этому файлу.
  const contentBoxEl = useTemplateRef<HTMLDivElement>('contentBox');
  const textEl = useTemplateRef<HTMLSpanElement>('text');

  const {
    displayRuns,
    editing,
    lockedBy,
    liveText,
    formatTick,
    editableEl,
    startEditing,
    cancelEditing,
    refreshActiveMarks,
    onEditableBlur,
    onEditableInput,
    onEditableKeydownEnter,
    onEditableBeforeInput,
    onEditableCompositionStart,
    onEditableCompositionEnd,
    onEditablePaste,
    onEditableDrop,
  } = useRichTextEditing({ itemId, canEdit, isSelected, content, buildContent });

  /**
   * Размер шрифта подбирается под фиксированный бокс карточки (не бокс растёт
   * под текст) — см. `use-fit-font-size.ts`. Один и тот же расчёт для обоих
   * режимов (просмотр/редактирование), чтобы шрифт не «прыгал» при входе в
   * редактирование.
   */
  const fitText = computed(() => {
    // Формат (жирный/зачёркнутый) меняет ширину текста без изменения его длины —
    // `liveText` в этот момент не поменялась бы сама по себе, поэтому дополнительно
    // зависим от `formatTick`, чтобы авто-fit пересчитался и после клика по тулбару
    void formatTick.value;
    return editing.value ? liveText.value : content.value.text;
  });
  const boxWidth = computed(() => data.value.width);
  const boxHeight = computed(() => data.value.height);
  const measureEl = computed(() => (editing.value ? editableEl.value : textEl.value));
  const fontSize = useFitFontSize(
    contentBoxEl,
    measureEl,
    fitText,
    boxWidth,
    boxHeight,
    editing,
    baseFontSize,
    fontSizeMode,
  );

  /** Тулбар должен показывать отрисованный, а не сохранённый базовый размер. */
  let reportedItemId: string | null = null;
  watch(
    [() => itemId, fontSize],
    ([id, size]) => {
      if (!effectiveFontSizes) return;
      if (reportedItemId && reportedItemId !== id) effectiveFontSizes.remove(reportedItemId);
      effectiveFontSizes.set(id, size);
      reportedItemId = id;
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (reportedItemId) effectiveFontSizes?.remove(reportedItemId);
  });

  /**
   * Координаты резайзера на момент `resizeStart` (до какого-либо движения) —
   * точка отсчёта для `resizeAxisFlags` (см. `board-snap.ts`: сравнение
   * ТЕКУЩИХ `x`/`y` с этими стартовыми говорит, инвертирующий ли хендл тянут,
   * НЕ знак `direction` резайзера — тот кодирует рост/сжатие, а не сторону).
   */
  let resizeStart: BoardResizeStartParams = { x: 0, y: 0 };

  function onResizeStart({ params: { x, y } }: { params: BoardResizeStartParams }): void {
    resizeStart = { x, y };
  }

  function originRect() {
    return {
      id: itemId,
      x: data.value.x,
      y: data.value.y,
      width: data.value.width,
      height: data.value.height,
    };
  }

  /**
   * Live-подсказка выравнивания во время resize (22.3) — только гиды, без
   * мутации геометрии: сама геометрия по-прежнему рисуется библиотекой, снап
   * применяется один раз на resize-end (тот же принцип, что и у drag, 19.30).
   */
  function onResize({ params: { x, y, width, height } }: { params: BoardResizeParams }): void {
    const origin = originRect();
    const flags = resizeAxisFlags(resizeStart.x, resizeStart.y, origin, x, y, width, height);
    const rect = resizeRectFromOrigin(origin, width, height, flags);
    resizeSnap?.updateGuides(itemId, rect, flags, lockAspectRatio);
  }

  /**
   * Форма события резайза — только нужные поля `NodeResizer`'s `OnResizeEnd`
   * из `@vue-flow/node-resizer`, а не сам тип: composable живёт в
   * `features/boards`, где прямой импорт Vue Flow запрещён (19.36) — конечная
   * геометрия резайза не зависит от библиотеки.
   *
   * В `auto` (26.08.2026, по референсу Miro) resize ещё и пересчитывает
   * `style.fontSize` пропорционально ИМЕННО ЭТОМУ действию (якорь
   * `fontSizeBoxWidth/Height` → новые `width/height`), сохраняя оба значения
   * как новую базу/якорь — а не оставляет реактивному `useFitFontSize` каждый
   * раз заново домножать на отношение к ФИКСИРОВАННОЙ геометрии элемента по
   * умолчанию (так было раньше). Раньше переключение auto↔manual могло дать
   * неожиданный скачок числа — база оставалась «как для дефолтного бокса»,
   * даже если бокс давно не дефолтного размера, и при возврате в auto тут же
   * пересчитывалась с нуля от него. Теперь база актуальна для текущего бокса
   * в `auto` сразу после КАЖДОГО resize — а в `manual` resize её (и якорь)
   * намеренно НЕ трогает вовсе, оставляя якорь «отставшим» от текущего
   * бокса — расхождение накапливается и досчитывается одним пересчётом при
   * обратном переключении в `auto` (`setSelectedFontSizeMode` в
   * `use-board-selection.ts`), а не молча теряется (баг из живой проверки:
   * `manual=4` → resize 2x → переключение на `auto` не меняло число).
   *
   * Снап к соседним элементам (22.3) применяется здесь же, ДО пересчёта
   * шрифта — итоговый (уже подровненный) размер бокса и есть та геометрия,
   * от которой должен масштабироваться шрифт в `auto`, а не сырое значение
   * из события резайза.
   */
  function onResizeEnd({ params: { x, y, width, height } }: { params: BoardResizeParams }): void {
    const origin = originRect();
    const flags = resizeAxisFlags(resizeStart.x, resizeStart.y, origin, x, y, width, height);
    const rect = resizeRectFromOrigin(origin, width, height, flags);
    const snapped = resizeSnap?.applySnap(itemId, rect, flags, lockAspectRatio) ?? rect;
    resizeSnap?.clearGuides();
    const patch: {
      x: number;
      y: number;
      width: number;
      height: number;
      style?: { fontSize: number; fontSizeBoxWidth: number; fontSizeBoxHeight: number };
    } = { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height };
    if (fontSizeMode.value === 'auto') {
      const anchorWidth = data.value.style.fontSizeBoxWidth ?? data.value.width;
      const anchorHeight = data.value.style.fontSizeBoxHeight ?? data.value.height;
      const nextFontSize = Math.min(
        BOARD_ITEM_FONT_SIZE_MAX,
        Math.max(
          BOARD_ITEM_FONT_SIZE_MIN,
          getScaledFontSize(
            baseFontSize.value,
            snapped.width,
            snapped.height,
            anchorWidth,
            anchorHeight,
          ),
        ),
      );
      if (nextFontSize !== baseFontSize.value) {
        patch.style = {
          fontSize: nextFontSize,
          fontSizeBoxWidth: snapped.width,
          fontSizeBoxHeight: snapped.height,
        };
      }
    }
    void boardSession.applyOps([
      {
        type: 'item.patch',
        clientOpId: crypto.randomUUID(),
        id: itemId,
        patch,
      },
    ]);
  }

  return {
    bgColor,
    textColor,
    fontFamily,
    textAlign,
    fontSize,
    displayRuns,
    editing,
    lockedBy,
    startEditing,
    cancelEditing,
    refreshActiveMarks,
    onEditableBlur,
    onEditableInput,
    onEditableKeydownEnter,
    onEditableBeforeInput,
    onEditableCompositionStart,
    onEditableCompositionEnd,
    onEditablePaste,
    onEditableDrop,
    onResizeStart,
    onResize,
    onResizeEnd,
  };
}
