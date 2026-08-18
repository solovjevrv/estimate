<script setup lang="ts">
/**
 * Визуальные направляющие snap-гидов (13.6) — пунктирные линии, которые
 * появляются во время перетаскивания, когда элемент притягивается к выравниванию
 * с другими элементами. Рендерятся как absolutely-позиционированные div'ы
 * внутри <VueFlow> — те же screen-координаты, что и BoardSelectionToolbar
 * (viewport.x + canvasCoord * viewport.zoom), а не внутри .vue-flow__pane,
 * чтобы не двойной трансформ не применялся.
 *
 * pointer-events: none — направляющие не перехватывают мышь, drag продолжается сквозь них.
 * Линия ограничена координатами from/to (canvas) — соединяет перетаскиваемый
 * элемент с целевым, а не растягивается на всю доску.
 */
import { computed } from 'vue';

import type { SnapGuide } from '../../features/boards/domain/board-snap';

const props = defineProps<{
  /** Активные направляющие для отрисовки */
  guides: readonly SnapGuide[];
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
    if (g.orientation === 'vertical') {
      // Вертикальная линия: x = position, y от from до to
      const screenX = vx + g.position * z;
      const screenFromY = vy + g.from * z;
      const screenToY = vy + g.to * z;
      const top = Math.min(screenFromY, screenToY);
      const height = Math.abs(screenToY - screenFromY);
      return {
        key: i,
        orientation: 'vertical' as const,
        style: {
          left: `${screenX}px`,
          top: `${top}px`,
          height: `${Math.max(height, 1)}px`,
        },
      };
    }
    // Горизонтальная линия: y = position, x от from до to
    const screenY = vy + g.position * z;
    const screenFromX = vx + g.from * z;
    const screenToX = vx + g.to * z;
    const left = Math.min(screenFromX, screenToX);
    const width = Math.abs(screenToX - screenFromX);
    return {
      key: i,
      orientation: 'horizontal' as const,
      style: {
        left: `${left}px`,
        top: `${screenY}px`,
        width: `${Math.max(width, 1)}px`,
      },
    };
  }),
);
</script>

<template>
  <div v-if="items.length" data-testid="board-snap-guides" class="board-snap-guides">
    <div
      v-for="item in items"
      :key="item.key"
      data-testid="board-snap-guide"
      class="board-snap-guide"
      :class="`board-snap-guide--${item.orientation}`"
      :style="item.style"
    />
  </div>
</template>

<style scoped>
.board-snap-guides {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
}

.board-snap-guide {
  position: absolute;
  opacity: 0.4;
  pointer-events: none;
  box-sizing: border-box;
}

.board-snap-guide--vertical {
  width: 1px;
  left: 0;
  background: repeating-linear-gradient(
    to bottom,
    var(--brand-ink2) 0,
    var(--brand-ink2) 3px,
    transparent 3px,
    transparent 7px
  );
}

.board-snap-guide--horizontal {
  height: 1px;
  top: 0;
  background: repeating-linear-gradient(
    to right,
    var(--brand-ink2) 0,
    var(--brand-ink2) 3px,
    transparent 3px,
    transparent 7px
  );
}
</style>
