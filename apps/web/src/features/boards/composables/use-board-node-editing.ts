/**
 * Общая механика узлов доски с редактируемым текстом (стикер/фигура, 17.5) —
 * до этого одна и та же связка (цвет/шрифт из `style`, `useRichTextEditing`,
 * авто-fit шрифта через `useFitFontSize`, публикация отрисованного размера в
 * реестр тулбара, `onResizeEnd`) была продублирована почти дословно в
 * `BoardStickyNode.vue` и `BoardShapeNode.vue`. Разница между узлами —
 * форма `content` (`buildContent`) и специфичная геометрия/оформление
 * (ромб/скругление у фигуры, реакции у стикера) — остаётся в самих компонентах.
 */
import type { BoardItem, BoardItemContent, BoardTextRun } from '@poker/shared';
import { computed, inject, onBeforeUnmount, useTemplateRef, watch, type Ref } from 'vue';

import { BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY } from '../context/board-canvas-keys';
import { readableTextColor } from '../domain/board-colors';
import { boardFontFamilyCss } from '../config/board-item-defaults';
import { FIT_FONT_MAX, useFitFontSize } from './use-fit-font-size';
import { useRichTextEditing } from './use-rich-text-editing';
import { useBoardSessionStore } from '../../../stores/board-session';

export interface BoardResizeParams {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseBoardNodeEditingOptions<TContent extends BoardItemContent & { text: string }> {
  itemId: string;
  /** `props.data` целиком — цвет/шрифт/ширина/высота читаются из него. */
  data: Ref<BoardItem>;
  canEdit: Ref<boolean>;
  /** `props.selected` из Vue Flow — прокидывается в `useRichTextEditing` как есть. */
  isSelected: Ref<boolean>;
  content: Ref<TContent>;
  buildContent: (text: string, runs: BoardTextRun[] | undefined) => TContent;
  /** Геометрия по умолчанию для масштабирования базового размера шрифта при resize. */
  defaultWidth: number;
  defaultHeight: number;
}

export function useBoardNodeEditing<TContent extends BoardItemContent & { text: string }>(
  options: UseBoardNodeEditingOptions<TContent>,
) {
  const { itemId, data, canEdit, isSelected, content, buildContent, defaultWidth, defaultHeight } =
    options;
  const boardSession = useBoardSessionStore();
  const effectiveFontSizes = inject(BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY, null);

  const bgColor = computed(() => data.value.style.color);
  const textColor = computed(() => data.value.style.textColor ?? readableTextColor(bgColor.value));
  const fontFamily = computed(() => boardFontFamilyCss(data.value.style.fontFamily));
  const textAlign = computed(() => data.value.style.textAlign ?? 'center');
  const baseFontSize = computed(() => data.value.style.fontSize ?? FIT_FONT_MAX);

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
    defaultWidth,
    defaultHeight,
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
   * Форма события резайза — только нужные поля `NodeResizer`'s `OnResizeEnd`
   * из `@vue-flow/node-resizer`, а не сам тип: composable живёт в
   * `features/boards`, где прямой импорт Vue Flow запрещён (19.36) — конечная
   * геометрия резайза не зависит от библиотеки.
   */
  function onResizeEnd({ params: { x, y, width, height } }: { params: BoardResizeParams }): void {
    void boardSession.applyOps([
      {
        type: 'item.patch',
        clientOpId: crypto.randomUUID(),
        id: itemId,
        patch: { x, y, width, height },
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
    onResizeEnd,
  };
}
