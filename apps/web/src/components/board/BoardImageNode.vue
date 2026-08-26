<script setup lang="ts">
import type { BoardItem, BoardImageContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResize, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, ref } from 'vue';

import {
  BOARD_CAN_EDIT_KEY,
  BOARD_RESIZE_SNAP_KEY,
} from '../../features/boards/context/board-canvas-keys';
import {
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_MIN_HEIGHT,
  IMAGE_MIN_WIDTH,
} from '../../features/boards/config/board-item-defaults';
import type { ResizeDirection } from '../../features/boards/domain/board-snap';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const resizeSnap = inject(BOARD_RESIZE_SNAP_KEY, null);

const content = computed(() => props.data.content as BoardImageContent);
const imageUrl = computed(() => content.value.url);

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
      @resize="onResize"
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
</style>
