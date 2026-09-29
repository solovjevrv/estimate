<script setup lang="ts">
import type { BoardItem, BoardImageContent } from '@estimate/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import {
  NodeResizer,
  type OnResize,
  type OnResizeEnd,
  type OnResizeStart,
} from '@vue-flow/node-resizer';
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
import { resizeAxisFlags, resizeRectFromOrigin } from '../../features/boards/domain/board-snap';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const resizeSnap = inject(BOARD_RESIZE_SNAP_KEY, null);

const content = computed(() => props.data.content as BoardImageContent);
const imageUrl = computed(() => content.value.url);

/** Координаты резайзера на момент `resizeStart` — точка отсчёта для
 * `resizeAxisFlags` (см. `use-board-node-editing.ts`/`board-snap.ts`). */
let resizeStart = { x: 0, y: 0 };

function onResizeStart({ params: { x, y } }: OnResizeStart): void {
  resizeStart = { x, y };
}

/** Геометрия ДО жеста — заведомо абсолютная (`BoardItem.x/y`), в отличие от
 * `params.x/y` резайзера (см. `resizeRectFromOrigin`). */
function originRect() {
  return {
    id: props.id,
    x: props.data.x,
    y: props.data.y,
    width: props.data.width,
    height: props.data.height,
  };
}

function onResize({ params: { x, y, width, height } }: OnResize): void {
  const origin = originRect();
  const flags = resizeAxisFlags(resizeStart.x, resizeStart.y, origin, x, y, width, height);
  const rect = resizeRectFromOrigin(origin, width, height, flags);
  resizeSnap?.updateGuides(props.id, rect, flags, true);
}

function onResizeEnd({ params: { x, y, width, height } }: OnResizeEnd): void {
  const origin = originRect();
  const flags = resizeAxisFlags(resizeStart.x, resizeStart.y, origin, x, y, width, height);
  const rect = resizeRectFromOrigin(origin, width, height, flags);
  const snapped = resizeSnap?.applySnap(props.id, rect, flags, true) ?? rect;
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
      @resize-start="onResizeStart"
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
