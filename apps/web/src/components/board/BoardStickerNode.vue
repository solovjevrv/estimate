<script setup lang="ts">
import type { BoardItem, BoardStickerContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, ref } from 'vue';

import { BOARD_CAN_EDIT_KEY } from '../../features/boards/board-canvas-keys';
import {
  STICKER_MAX_HEIGHT,
  STICKER_MAX_WIDTH,
  STICKER_MIN_HEIGHT,
  STICKER_MIN_WIDTH,
} from '../../lib/board/board-item-defaults';
import { findStickerAsset } from '../../lib/board/sticker-packs';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));

const content = computed(() => props.data.content as BoardStickerContent);
const stickerAsset = computed(() => findStickerAsset(content.value.pack, content.value.id));
const imageUrl = computed(() => stickerAsset.value?.src);
const altText = computed(() => stickerAsset.value?.emoji ?? 'sticker');

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
  <div
    class="board-node-resizer-gap relative h-full w-full"
    data-testid="board-node-sticker"
    :data-node-id="props.id"
    :data-selected="props.selected ? 'true' : 'false'"
  >
    <NodeResizer
      :is-visible="props.selected && canEdit"
      :min-width="STICKER_MIN_WIDTH"
      :min-height="STICKER_MIN_HEIGHT"
      :max-width="STICKER_MAX_WIDTH"
      :max-height="STICKER_MAX_HEIGHT"
      keep-aspect-ratio
      @resize-end="onResizeEnd"
    />
    <div
      data-testid="board-node-content"
      class="board-node-content relative flex h-full w-full items-center justify-center overflow-hidden"
      @dblclick.stop
    >
      <template v-if="imageUrl">
        <img
          :src="imageUrl"
          :alt="altText"
          data-testid="board-node-sticker-image"
          class="h-full w-full object-contain"
          draggable="false"
          @load.stop
          @error.stop
        />
      </template>
      <template v-else>
        <!-- Плейсхолдер для неизвестного pack/id -->
        <div class="board-sticker-placeholder flex h-full w-full items-center justify-center">
          <UIcon name="i-lucide-image-off" class="size-8 opacity-50" />
        </div>
      </template>
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

/* Стикер-элемент — без фона/заливки/рамки, просто картинка */

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

.board-sticker-placeholder {
  background: var(--ui-bg-elevated);
  border: 1px dashed var(--ui-border);
  border-radius: 8px;
}
</style>
