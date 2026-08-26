<script setup lang="ts">
/** Рендер GIF из Giphy на доске (21.9) — почти идентичен BoardImageNode.vue,
 *  отличие только в резолве URL: не сохранённый в content путь на нашей
 *  доске, а прокси-эндпоинт по id (`giphyMediaUrl`) — сервер сам стримит
 *  байты с Giphy, клиент никогда не обращается к Giphy напрямую. */
import type { BoardGiphyContent, BoardItem } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, ref } from 'vue';

import { BOARD_CAN_EDIT_KEY } from '../../features/boards/context/board-canvas-keys';
import { giphyMediaUrl } from '../../features/boards/api/giphy-api';
import {
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_MIN_HEIGHT,
  IMAGE_MIN_WIDTH,
} from '../../features/boards/config/board-item-defaults';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));

const content = computed(() => props.data.content as BoardGiphyContent);
const mediaUrl = computed(() => giphyMediaUrl(content.value.id, 'full'));

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
    data-testid="board-node-giphy"
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
        :src="mediaUrl"
        alt=""
        class="h-full w-full object-contain"
        data-testid="board-node-giphy-image"
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
