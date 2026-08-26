<script setup lang="ts">
import type { BoardItem, BoardEmojiContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResize, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, ref } from 'vue';

import {
  BOARD_CAN_EDIT_KEY,
  BOARD_RESIZE_SNAP_KEY,
} from '../../features/boards/context/board-canvas-keys';
import {
  EMOJI_FONT_SIZE_RATIO,
  EMOJI_MAX_HEIGHT,
  EMOJI_MAX_WIDTH,
  EMOJI_MIN_HEIGHT,
  EMOJI_MIN_WIDTH,
} from '../../features/boards/config/board-item-defaults';
import type { ResizeDirection } from '../../features/boards/domain/board-snap';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const resizeSnap = inject(BOARD_RESIZE_SNAP_KEY, null);

const content = computed(() => props.data.content as BoardEmojiContent);
const emoji = computed(() => content.value.emoji);
// Размер шрифта не хранится отдельно — следует за боксом (как масштаб картинки
// внутри рамки), поэтому резайз хендлами реально меняет то, что видно
const fontSize = computed(
  () => Math.min(props.data.width, props.data.height) * EMOJI_FONT_SIZE_RATIO,
);

/** См. `use-board-node-editing.ts` — тот же паттерн snap guides при resize (22.3). */
let lastResizeDirection: ResizeDirection = [0, 0];

function onResize({ params: { x, y, width, height, direction } }: OnResize): void {
  lastResizeDirection = direction;
  resizeSnap?.updateGuides(props.id, { id: props.id, x, y, width, height }, direction, true);
}

function onResizeEnd({ params: { x, y, width, height } }: OnResizeEnd): void {
  const snapped = resizeSnap?.applySnap(
    props.id,
    { id: props.id, x, y, width, height },
    lastResizeDirection,
    true,
  ) ?? { x, y, width, height };
  resizeSnap?.clearGuides();
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: crypto.randomUUID(),
      id: props.id,
      patch: snapped,
    },
  ]);
}
</script>

<template>
  <div
    class="board-node-resizer-gap relative h-full w-full"
    data-testid="board-node-emoji"
    :data-node-id="props.id"
    :data-selected="props.selected ? 'true' : 'false'"
  >
    <NodeResizer
      :is-visible="props.selected && canEdit"
      :min-width="EMOJI_MIN_WIDTH"
      :min-height="EMOJI_MIN_HEIGHT"
      :max-width="EMOJI_MAX_WIDTH"
      :max-height="EMOJI_MAX_HEIGHT"
      keep-aspect-ratio
      @resize="onResize"
      @resize-end="onResizeEnd"
    />
    <div
      data-testid="board-node-content"
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
      <Handle
        id="top"
        type="source"
        :position="Position.Top"
        class="board-connect-handle"
        data-testid="board-handle"
      />
      <Handle
        id="right"
        type="source"
        :position="Position.Right"
        class="board-connect-handle"
        data-testid="board-handle"
      />
      <Handle
        id="bottom"
        type="source"
        :position="Position.Bottom"
        class="board-connect-handle"
        data-testid="board-handle"
      />
      <Handle
        id="left"
        type="source"
        :position="Position.Left"
        class="board-connect-handle"
        data-testid="board-handle"
      />
    </template>
  </div>
</template>

<style scoped>
@import './shared/board-node-resizer.css';
@import './shared/board-connect-handle.css';

/* Эмодзи-элемент — без фона/заливки/рамки, просто большой unicode-символ */
</style>
