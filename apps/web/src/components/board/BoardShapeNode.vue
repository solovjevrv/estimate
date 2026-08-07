<script setup lang="ts">
import { BOARD_ITEM_TEXT_MAX_LENGTH, type BoardItem, type BoardShapeContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, nextTick, onMounted, ref, useTemplateRef } from 'vue';

import { BOARD_CAN_EDIT_KEY, BOARD_PENDING_EDIT_ID_KEY } from '../../lib/board/board-canvas-keys';
import { darkenHex, readableTextColor } from '../../lib/board/board-colors';
import {
  SHAPE_MAX_HEIGHT,
  SHAPE_MAX_WIDTH,
  SHAPE_MIN_HEIGHT,
  SHAPE_MIN_WIDTH,
} from '../../lib/board/board-item-defaults';
import { useFitFontSize } from '../../lib/board/use-fit-font-size';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const pendingEditId = inject(BOARD_PENDING_EDIT_ID_KEY, ref(null));

const content = computed(() => props.data.content as BoardShapeContent);
const bgColor = computed(() => props.data.style.color);
/** Обводка — заметно более тёмный вариант того же тона, не отдельный цвет */
const borderColor = computed(() => darkenHex(bgColor.value, 0.2));
const textColor = computed(() => readableTextColor(bgColor.value));

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

const editing = ref(false);
const draftText = ref('');
const contentBoxEl = useTemplateRef<HTMLDivElement>('contentBox');
const textareaEl = useTemplateRef<HTMLTextAreaElement>('textarea');
const textEl = useTemplateRef<HTMLSpanElement>('text');

/**
 * Размер шрифта подбирается под фиксированный бокс карточки (не бокс растёт
 * под текст) — см. `use-fit-font-size.ts`. Один и тот же расчёт для обоих
 * режимов (просмотр/редактирование), чтобы шрифт не «прыгал» при входе в
 * редактирование. `manageHeight` — только для textarea в момент редактирования.
 */
const fitText = computed(() => (editing.value ? draftText.value : content.value.text));
const boxWidth = computed(() => props.data.width);
const boxHeight = computed(() => props.data.height);
const measureEl = computed(() => (editing.value ? textareaEl.value : textEl.value));
const fontSize = useFitFontSize(contentBoxEl, measureEl, fitText, boxWidth, boxHeight, editing);

async function startEditing(): Promise<void> {
  if (editing.value || !canEdit.value) return;
  draftText.value = content.value.text;
  editing.value = true;
  await nextTick();
  textareaEl.value?.focus();
  textareaEl.value?.select();
}

// Только что созданная этим же клиентом фигура сразу входит в редактирование —
// как и у стикера (12.6), иначе первое, что видит пользователь, — пустая карточка
onMounted(() => {
  if (pendingEditId.value === props.id) {
    pendingEditId.value = null;
    void startEditing();
  }
});

function commitEditing(): void {
  if (!editing.value) return;
  editing.value = false;
  const text = draftText.value.slice(0, BOARD_ITEM_TEXT_MAX_LENGTH);
  if (text === content.value.text) return;
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: crypto.randomUUID(),
      id: props.id,
      patch: { content: { type: 'shape', shape: content.value.shape, text } },
    },
  ]);
}

function cancelEditing(): void {
  editing.value = false;
}

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
          <textarea
            ref="textarea"
            v-model="draftText"
            :maxlength="BOARD_ITEM_TEXT_MAX_LENGTH"
            class="nodrag h-full w-full resize-none overflow-hidden bg-transparent text-center font-semibold outline-none"
            :style="{ color: textColor, fontSize: `${fontSize}px` }"
            @pointerdown.stop
            @keydown.esc.stop.prevent="cancelEditing"
            @blur="commitEditing"
          />
        </template>
        <template v-else>
          <span
            ref="text"
            class="block w-full overflow-hidden break-words whitespace-pre-wrap"
            :style="{ fontSize: `${fontSize}px` }"
            >{{ content.text }}</span
          >
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
