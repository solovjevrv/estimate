<script setup lang="ts">
import type { BoardItem, BoardImageContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, ref } from 'vue';

import { BOARD_CAN_EDIT_KEY } from '../../features/boards/board-canvas-keys';
import {
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_MIN_HEIGHT,
  IMAGE_MIN_WIDTH,
} from '../../lib/board/board-item-defaults';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));

const content = computed(() => props.data.content as BoardImageContent);
const imageUrl = computed(() => content.value.url);

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
    data-testid="board-node-image"
    :data-node-id="props.id"
    :data-selected="props.selected ? 'true' : 'false'"
  >
    <NodeResizer
      :is-visible="props.selected && canEdit"
      :min-width="IMAGE_MIN_WIDTH"
      :min-height="IMAGE_MIN_HEIGHT"
      :max-width="IMAGE_MAX_WIDTH"
      :max-height="IMAGE_MAX_HEIGHT"
      keep-aspect-ratio
      @resize-end="onResizeEnd"
    />
    <div
      data-testid="board-node-content"
      class="board-node-content relative flex h-full w-full items-center justify-center overflow-hidden"
      @dblclick.stop
    >
      <img
        :src="imageUrl"
        alt=""
        class="h-full w-full object-contain"
        data-testid="board-node-image-image"
        @load.stop
        @error.stop
      />
    </div>
    <!-- Связи — см. BoardStickyNode.vue -->
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
