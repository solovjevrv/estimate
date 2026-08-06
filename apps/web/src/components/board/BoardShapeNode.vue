<script setup lang="ts">
import type { BoardItem, BoardShapeContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { computed } from 'vue';

import { BOARD_COLOR_CLASSES } from '../../lib/board/board-colors';

const props = defineProps<NodeProps<BoardItem>>();

const content = computed(() => props.data.content as BoardShapeContent);
const colorClasses = computed(() => BOARD_COLOR_CLASSES[props.data.style.color]);

const shapeClass = computed(() => {
  switch (content.value.shape) {
    case 'rounded':
      return 'rounded-2xl';
    case 'ellipse':
      return 'rounded-full';
    case 'diamond':
      return 'rotate-45';
    case 'rectangle':
    default:
      return 'rounded-none';
  }
});
</script>

<template>
  <div
    class="board-node-content flex h-full w-full items-center justify-center overflow-hidden border-2"
    :class="[shapeClass, colorClasses]"
  >
    <Handle type="target" :position="Position.Top" class="!opacity-0" />
    <div
      class="max-w-full px-2 text-center text-sm break-words text-neutral-900"
      :class="content.shape === 'diamond' ? '-rotate-45' : ''"
    >
      {{ content.text }}
    </div>
    <Handle type="source" :position="Position.Bottom" class="!opacity-0" />
  </div>
</template>
