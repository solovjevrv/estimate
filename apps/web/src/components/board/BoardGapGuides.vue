<script setup lang="ts">
/**
 * Визуальные направляющие равных отступов (22.6, Figma-style) — оранжевая
 * линия зазора + лейбл с числом px. Отдельный визуальный язык от
 * `BoardSnapGuides.vue` (точечное выравнивание): там просто пунктирная линия
 * без подписи, здесь — измерение расстояния, подпись обязательна, иначе
 * пользователю неясно, что именно совпало.
 *
 * Те же screen-координаты, что и `BoardSnapGuides` (viewport.x + canvasCoord
 * * viewport.zoom), pointer-events: none — направляющие не мешают драгу.
 */
import { computed } from 'vue';

import type { GapGuide } from '../../features/boards/domain/board-snap';

const props = defineProps<{
  /** Активные направляющие равных отступов для отрисовки */
  guides: readonly GapGuide[];
  /** Позиция viewport из Vue Flow — x/y панорамирования, zoom масштаба */
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
}>();

const items = computed(() =>
  props.guides.map((g, i) => {
    const z = props.viewportZoom;
    const vx = props.viewportX;
    const vy = props.viewportY;
    if (g.axis === 'horizontal') {
      const screenFromX = vx + g.from * z;
      const screenToX = vx + g.to * z;
      const screenY = vy + g.cross * z;
      const left = Math.min(screenFromX, screenToX);
      const width = Math.abs(screenToX - screenFromX);
      return {
        key: i,
        axis: 'horizontal' as const,
        label: `${g.gap}`,
        lineStyle: {
          left: `${left}px`,
          top: `${screenY}px`,
          width: `${Math.max(width, 1)}px`,
        },
        labelStyle: {
          left: `${left + width / 2}px`,
          top: `${screenY}px`,
        },
      };
    }
    const screenFromY = vy + g.from * z;
    const screenToY = vy + g.to * z;
    const screenX = vx + g.cross * z;
    const top = Math.min(screenFromY, screenToY);
    const height = Math.abs(screenToY - screenFromY);
    return {
      key: i,
      axis: 'vertical' as const,
      label: `${g.gap}`,
      lineStyle: {
        left: `${screenX}px`,
        top: `${top}px`,
        height: `${Math.max(height, 1)}px`,
      },
      labelStyle: {
        left: `${screenX}px`,
        top: `${top + height / 2}px`,
      },
    };
  }),
);
</script>

<template>
  <div v-if="items.length" data-testid="board-gap-guides" class="board-gap-guides">
    <template v-for="item in items" :key="item.key">
      <div
        data-testid="board-gap-guide-line"
        class="board-gap-guide-line"
        :class="`board-gap-guide-line--${item.axis}`"
        :style="item.lineStyle"
      />
      <div
        data-testid="board-gap-guide-label"
        class="board-gap-guide-label"
        :style="item.labelStyle"
      >
        {{ item.label }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.board-gap-guides {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 11;
}

.board-gap-guide-line {
  position: absolute;
  background: var(--brand-amber);
  pointer-events: none;
}

.board-gap-guide-line--horizontal {
  height: 1px;
}

.board-gap-guide-line--vertical {
  width: 1px;
}

.board-gap-guide-label {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--brand-amber);
  /* Не токен --brand-ink: тот инвертируется в тёмной теме (почти белый), а фон
     метки — --brand-amber — светлый в обеих темах, тёмный текст нужен всегда. */
  color: oklch(20% 0.02 250);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
}
</style>
