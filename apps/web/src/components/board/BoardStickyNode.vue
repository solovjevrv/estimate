<script setup lang="ts">
import { BOARD_ITEM_TEXT_MAX_LENGTH, type BoardItem, type BoardStickyContent } from '@poker/shared';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, nextTick, onMounted, ref, useTemplateRef } from 'vue';

import { BOARD_CAN_EDIT_KEY, BOARD_PENDING_EDIT_ID_KEY } from '../../lib/board/board-canvas-keys';
import {
  STICKY_MAX_HEIGHT,
  STICKY_MAX_WIDTH,
  STICKY_MIN_HEIGHT,
  STICKY_MIN_WIDTH,
} from '../../lib/board/board-item-defaults';
import { BOARD_COLOR_BG_CLASSES, BOARD_COLOR_TEXT_CLASSES } from '../../lib/board/board-colors';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const { viewport } = useVueFlow();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const pendingEditId = inject(BOARD_PENDING_EDIT_ID_KEY, ref(null));

const content = computed(() => props.data.content as BoardStickyContent);
const bgClass = computed(() => BOARD_COLOR_BG_CLASSES[props.data.style.color]);
const textClass = computed(() => BOARD_COLOR_TEXT_CLASSES[props.data.style.color]);

const editing = ref(false);
const draftText = ref('');
const textareaEl = useTemplateRef<HTMLTextAreaElement>('textarea');

async function startEditing(): Promise<void> {
  if (editing.value || !canEdit.value) return;
  draftText.value = content.value.text;
  editing.value = true;
  await nextTick();
  textareaEl.value?.focus();
  textareaEl.value?.select();
}

// Только что созданный этим же клиентом стикер сразу входит в редактирование —
// иначе первое, что видит пользователь после создания, это пустая карточка
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
      patch: { content: { type: 'sticky', text } },
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
      :min-width="STICKY_MIN_WIDTH"
      :min-height="STICKY_MIN_HEIGHT"
      :max-width="STICKY_MAX_WIDTH"
      :max-height="STICKY_MAX_HEIGHT"
      color="var(--ui-primary)"
      @resize-end="onResizeEnd"
    />
    <div
      class="board-sticky-content flex h-full w-full items-start justify-start overflow-hidden rounded-md p-4 text-sm font-semibold break-words whitespace-pre-wrap"
      :class="[bgClass, textClass]"
      @dblclick.stop="startEditing"
    >
      <Handle type="target" :position="Position.Top" class="!opacity-0" />
      <template v-if="editing">
        <textarea
          ref="textarea"
          v-model="draftText"
          :maxlength="BOARD_ITEM_TEXT_MAX_LENGTH"
          class="nodrag h-full w-full resize-none bg-transparent text-sm font-semibold outline-none"
          :class="textClass"
          :style="{ fontSize: `${Math.max(10, 14 / viewport.zoom)}px` }"
          @pointerdown.stop
          @keydown.esc.stop.prevent="cancelEditing"
          @blur="commitEditing"
        />
      </template>
      <template v-else>{{ content.text }}</template>
      <Handle type="source" :position="Position.Bottom" class="!opacity-0" />
    </div>
  </div>
</template>

<style scoped>
/* Стикер держится на тени, а не на обводке (референс `.design/main.html`) — заметно
   сильнее общей `--brand-shadow-card` (та калибрована под UI-панели, не бумагу) */
.board-sticky-content {
  box-shadow:
    0 1px 2px rgb(0 0 0 / 8%),
    0 6px 14px -6px rgb(0 0 0 / 18%);
}
</style>
