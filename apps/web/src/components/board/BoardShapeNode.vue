<script setup lang="ts">
import type { BoardItem, BoardShapeContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, ref, toRef, useTemplateRef } from 'vue';

import { BOARD_CAN_EDIT_KEY } from '../../lib/board/board-canvas-keys';
import { darkenHex, readableTextColor } from '../../lib/board/board-colors';
import {
  boardFontFamilyCss,
  SHAPE_MAX_HEIGHT,
  SHAPE_MAX_WIDTH,
  SHAPE_MIN_HEIGHT,
  SHAPE_MIN_WIDTH,
} from '../../lib/board/board-item-defaults';
import { FIT_FONT_MAX, useFitFontSize } from '../../lib/board/use-fit-font-size';
import { useRichTextEditing } from '../../lib/board/use-rich-text-editing';
import { useBoardSessionStore } from '../../stores/board-session';
import BoardRichText from './BoardRichText.vue';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));

const content = computed(() => props.data.content as BoardShapeContent);
const bgColor = computed(() => props.data.style.color);
/** Обводка — заметно более тёмный вариант того же тона, не отдельный цвет */
const borderColor = computed(() => darkenHex(bgColor.value, 0.2));
const textColor = computed(() => props.data.style.textColor ?? readableTextColor(bgColor.value));
const fontFamily = computed(() => boardFontFamilyCss(props.data.style.fontFamily));
const textAlign = computed(() => props.data.style.textAlign ?? 'center');
const maxFontSize = computed(() => props.data.style.fontSize ?? FIT_FONT_MAX);

/** Ромб — не поворот прямоугольника (искажался бы при несимметричном резайзе), а вырез
 * по границам бокса, чтобы форма оставалась настоящим ромбом при любом соотношении сторон */
const shapeClass = computed(() => {
  switch (content.value.shape) {
    case 'rounded':
      return 'rounded-2xl';
    case 'ellipse':
      return 'rounded-full';
    case 'rectangle':
    default:
      return 'rounded-none';
  }
});

/**
 * У ромба `border` не работает: clip-path вырезает форму из прямоугольного
 * бокса, а обводка рисуется ПО ГРАНИЦАМ этого бокса до выреза — после
 * clip-path от неё остаются только точки в местах, где ромб касается краёв
 * бокса (не сплошная линия). Вместо CSS-обводки — два вложенных ромба:
 * нижний (побольше, цвета обводки) и верхний (меньше на толщину обводки,
 * цвета заливки) — стандартный приём для «обводки» произвольной clip-path
 * формы, даёт визуально ту же обводку, что у остальных фигур.
 */
const isDiamond = computed(() => content.value.shape === 'diamond');
const DIAMOND_CLIP_PATH = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';

const contentBoxEl = useTemplateRef<HTMLDivElement>('contentBox');
const textEl = useTemplateRef<HTMLSpanElement>('text');

const {
  displayRuns,
  editing,
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
  onEditablePaste,
} = useRichTextEditing({
  itemId: props.id,
  canEdit,
  isSelected: toRef(props, 'selected'),
  content,
  buildContent: (text, runs) => ({
    type: 'shape',
    shape: content.value.shape,
    text,
    ...(runs ? { runs } : {}),
  }),
});

/**
 * Размер шрифта подбирается под фиксированный бокс карточки (не бокс растёт
 * под текст) — см. `use-fit-font-size.ts`. Один и тот же расчёт для обоих
 * режимов (просмотр/редактирование), чтобы шрифт не «прыгал» при входе в
 * редактирование. `manageHeight` — только для contenteditable в момент редактирования.
 */
const fitText = computed(() => {
  // Формат (жирный/зачёркнутый) меняет ширину текста без изменения его длины —
  // `liveText` в этот момент не поменялась бы сама по себе, поэтому дополнительно
  // зависим от `formatTick`, чтобы авто-fit пересчитался и после клика по тулбару
  void formatTick.value;
  return editing.value ? liveText.value : content.value.text;
});
const boxWidth = computed(() => props.data.width);
const boxHeight = computed(() => props.data.height);
const measureEl = computed(() => (editing.value ? editableEl.value : textEl.value));
const fontSize = useFitFontSize(
  contentBoxEl,
  measureEl,
  fitText,
  boxWidth,
  boxHeight,
  editing,
  maxFontSize,
);

function onResizeEnd({ params: { x, y, width, height } }: OnResizeEnd): void {
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: crypto.randomUUID(),
      id: props.id,
      patch: { x, y, width, height },
    },
  ]);
}
</script>

<template>
  <div class="relative h-full w-full">
    <NodeResizer
      :is-visible="props.selected && !editing && canEdit"
      :min-width="SHAPE_MIN_WIDTH"
      :min-height="SHAPE_MIN_HEIGHT"
      :max-width="SHAPE_MAX_WIDTH"
      :max-height="SHAPE_MAX_HEIGHT"
      color="var(--ui-primary)"
      @resize-end="onResizeEnd"
    />
    <div
      class="board-node-content relative flex h-full w-full items-center justify-center overflow-hidden p-4 font-semibold"
      :class="isDiamond ? '' : ['border-2', shapeClass]"
      :style="isDiamond ? {} : { backgroundColor: bgColor, borderColor, color: textColor }"
      @dblclick.stop="startEditing"
    >
      <template v-if="isDiamond">
        <div
          class="absolute inset-0"
          :style="{ backgroundColor: borderColor, clipPath: DIAMOND_CLIP_PATH }"
        />
        <div
          class="absolute inset-[2px]"
          :style="{ backgroundColor: bgColor, clipPath: DIAMOND_CLIP_PATH }"
        />
      </template>
      <div
        ref="contentBox"
        class="relative flex h-full w-full items-center justify-center text-center"
        :style="isDiamond ? { color: textColor } : {}"
      >
        <template v-if="editing">
          <div
            ref="editable"
            class="nodrag h-full w-full overflow-hidden bg-transparent font-semibold whitespace-pre-wrap outline-none"
            contenteditable="true"
            :style="{
              color: textColor,
              fontSize: `${fontSize}px`,
              fontFamily,
              textAlign,
            }"
            @pointerdown.stop
            @keydown.esc.stop.prevent="cancelEditing"
            @keydown.enter.prevent="onEditableKeydownEnter"
            @beforeinput="onEditableBeforeInput"
            @input="onEditableInput"
            @paste="onEditablePaste"
            @mouseup="refreshActiveMarks"
            @keyup="refreshActiveMarks"
            @blur="onEditableBlur"
          />
        </template>
        <template v-else>
          <span
            ref="text"
            class="block w-full overflow-hidden break-words whitespace-pre-wrap"
            :style="{ fontSize: `${fontSize}px`, fontFamily, textAlign }"
          >
            <BoardRichText :runs="displayRuns" />
          </span>
        </template>
      </div>
    </div>
    <!-- Связи (12.8) — см. пояснение в BoardStickyNode.vue. Вынесены за пределы
         .board-node-content, у которой overflow-hidden обрезал бы хендлы по
         краю (translate тянет их наполовину за границу бокса) -->
    <template v-if="canEdit">
      <Handle id="top" type="source" :position="Position.Top" class="board-connect-handle" />
      <Handle id="right" type="source" :position="Position.Right" class="board-connect-handle" />
      <Handle id="bottom" type="source" :position="Position.Bottom" class="board-connect-handle" />
      <Handle id="left" type="source" :position="Position.Left" class="board-connect-handle" />
    </template>
  </div>
</template>

<style scoped>
.board-connect-handle {
  width: 10px;
  height: 10px;
  background: var(--ui-primary);
  border: 2px solid var(--ui-bg);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.vue-flow__node:hover .board-connect-handle {
  opacity: 1;
}
</style>
