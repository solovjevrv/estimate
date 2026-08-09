<script setup lang="ts">
import type { BoardItem, BoardTextContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, ref, toRef, useTemplateRef } from 'vue';

import { BOARD_CAN_EDIT_KEY } from '../../lib/board/board-canvas-keys';
import { readableTextColor } from '../../lib/board/board-colors';
import {
  boardFontFamilyCss,
  TEXT_MAX_HEIGHT,
  TEXT_MAX_WIDTH,
  TEXT_MIN_HEIGHT,
  TEXT_MIN_WIDTH,
} from '../../lib/board/board-item-defaults';
import { FIT_FONT_MAX, useFitFontSize } from '../../lib/board/use-fit-font-size';
import { useRichTextEditing } from '../../lib/board/use-rich-text-editing';
import { useBoardSessionStore } from '../../stores/board-session';
import BoardRichText from './BoardRichText.vue';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));

const content = computed(() => props.data.content as BoardTextContent);
const textColor = computed(() => props.data.style.textColor ?? readableTextColor(props.data.style.color));
const fontFamily = computed(() => boardFontFamilyCss(props.data.style.fontFamily));
const textAlign = computed(() => props.data.style.textAlign ?? 'left');
const maxFontSize = computed(() => props.data.style.fontSize ?? FIT_FONT_MAX);

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
  buildContent: (text, runs) => ({ type: 'text', text, ...(runs ? { runs } : {}) }),
});

/**
 * Размер шрифта подбирается под фиксированный бокс карточки (не бокс растёт
 * под текст) — см. `use-fit-font-size.ts`. Один и тот же расчёт для обоих
 * режимов (просмотр/редактирование), чтобы шрифт не «прыгал» при входе в
 * редактирование. `manageHeight: true` — у contenteditable, как и у textarea
 * раньше, нет авторазмера по контенту, высотой в режиме редактирования
 * управляем сами.
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
      :min-width="TEXT_MIN_WIDTH"
      :min-height="TEXT_MIN_HEIGHT"
      :max-width="TEXT_MAX_WIDTH"
      :max-height="TEXT_MAX_HEIGHT"
      color="var(--ui-primary)"
      @resize-end="onResizeEnd"
    />
    <div
      ref="contentBox"
      class="board-text-content flex h-full w-full items-center overflow-hidden p-4"
      @dblclick.stop="startEditing"
    >
      <template v-if="editing">
        <div
          ref="editable"
          class="nodrag h-full w-full overflow-hidden bg-transparent whitespace-pre-wrap outline-none"
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
    <!--
      Связи (12.8): по видимой точке на сторону, все type="source" +
      connection-mode="loose" + увеличенный connection-radius на VueFlow — так
      с любой из четырёх можно и начать, и принять связь, а Vue Flow сам
      подхватит ближайшую точку карточки, даже если отпустили курсор чуть
      мимо неё. Куда именно приклеен конец связи — решает не автогеометрия
      (первая версия так и делала — неудобно, точка "прыгала" при переносе
      карточек), а конкретный id хендла, который реально был схвачен/отпущен
      (см. floating-edge-geometry.ts) — то есть точка фиксированная и
      предсказуемая, просто следует за карточкой при её переносе.
    -->
    <template v-if="canEdit">
      <Handle id="top" type="source" :position="Position.Top" class="board-connect-handle" />
      <Handle id="right" type="source" :position="Position.Right" class="board-connect-handle" />
      <Handle id="bottom" type="source" :position="Position.Bottom" class="board-connect-handle" />
      <Handle id="left" type="source" :position="Position.Left" class="board-connect-handle" />
    </template>
  </div>
</template>

<style scoped>
/* Текстовый элемент — без фона/заливки/рамки, как в макете .design/main.html */

.neutrag-connect-handle {
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