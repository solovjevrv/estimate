<script setup lang="ts">
import type { BoardItem, BoardEmojiContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, ref } from 'vue';

import { BOARD_CAN_EDIT_KEY } from '../../lib/board/board-canvas-keys';
import {
  EMOJI_FONT_SIZE_RATIO,
  EMOJI_MAX_HEIGHT,
  EMOJI_MAX_WIDTH,
  EMOJI_MIN_HEIGHT,
  EMOJI_MIN_WIDTH,
} from '../../lib/board/board-item-defaults';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));

const content = computed(() => props.data.content as BoardEmojiContent);
const emoji = computed(() => content.value.emoji);
// Размер шрифта не хранится отдельно — следует за боксом (как масштаб картинки
// внутри рамки), поэтому резайз хендлами реально меняет то, что видно
const fontSize = computed(
  () => Math.min(props.data.width, props.data.height) * EMOJI_FONT_SIZE_RATIO,
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
  <div class="board-node-resizer-gap relative h-full w-full">
    <NodeResizer
      :is-visible="props.selected && canEdit"
      :min-width="EMOJI_MIN_WIDTH"
      :min-height="EMOJI_MIN_HEIGHT"
      :max-width="EMOJI_MAX_WIDTH"
      :max-height="EMOJI_MAX_HEIGHT"
      keep-aspect-ratio
      @resize-end="onResizeEnd"
    />
    <div
      class="board-emoji-content flex h-full w-full items-center justify-center"
      :style="{ fontSize: `${fontSize}px` }"
    >
      {{ emoji }}
    </div>
    <!-- Связи (12.8): по видимой точке на сторону, все type="source" +
         connection-mode="loose" + увеличенный connection-radius на VueFlow — так
         с любой из четырёх можно и начать, и принять связь, а Vue Flow сам
         подхватит ближайшую точку карточки, даже если отпустили курсор чуть
         мимо неё. Куда именно приклеен конец связи — решает не автогеометрия
         (первая версия так и делала — неудобно, точка "прыгала" при переносе
         карточек), а конкретный id хендла, который реально был схвачен/отпущен
         (см. floating-edge-geometry.ts) — то есть точка фиксированная и
         предсказуемая, просто следует за карточкой при её переносе. -->
    <template v-if="canEdit">
      <Handle id="top" type="source" :position="Position.Top" class="board-connect-handle" />
      <Handle id="right" type="source" :position="Position.Right" class="board-connect-handle" />
      <Handle id="bottom" type="source" :position="Position.Bottom" class="board-connect-handle" />
      <Handle id="left" type="source" :position="Position.Left" class="board-connect-handle" />
    </template>
  </div>
</template>

<style scoped>
@import './shared/board-node-resizer.css';
@import './shared/board-connect-handle.css';

/* Эмодзи-элемент — без фона/заливки/рамки, просто большой unicode-символ */

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
