<script setup lang="ts">
import type { BoardItem, BoardStickyContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { computed } from 'vue';

import { BOARD_COLOR_CLASSES } from '../../lib/board/board-colors';

const props = defineProps<NodeProps<BoardItem>>();

const content = computed(() => props.data.content as BoardStickyContent);
const colorClasses = computed(() => BOARD_COLOR_CLASSES[props.data.style.color]);
</script>

<template>
  <div
    class="board-node-content flex h-full w-full items-start justify-start overflow-hidden rounded-md border-2 p-3 text-sm break-words whitespace-pre-wrap text-neutral-900 shadow-sm"
    :class="colorClasses"
  >
    <Handle type="target" :position="Position.Top" class="!opacity-0" />
    {{ content.text }}
    <Handle type="source" :position="Position.Bottom" class="!opacity-0" />
  </div>
</template>
