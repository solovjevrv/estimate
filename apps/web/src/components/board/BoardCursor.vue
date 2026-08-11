<script setup lang="ts">
/**
 * Чужой курсор участника доски (14.1). Позиционируется в world-координатах
 * Vue Flow (как в Miro): курсор рисуется на том же месте у всех участников,
 * независимо от их зума/панорамирования — для этого `BoardCanvas` проецирует
 * координаты через `project()` и передаёт уже готовые canvas-координаты, а
 * тут мы их обратно в viewport через `viewport` из `useVueFlow()`.
 *
 * Чужой курсор плавно интерполирует позицию (transition transform) — как и
 * чужие карточки (см. `.vue-flow__node:not(.dragging)` в BoardCanvas.vue):
 * throttled-рассылка (~80мс) дискретна, без сглаживания движение дергается.
 * Собственный курсор зритель не видит (он на клиенте отправителя не рендерится),
 * поэтому задержка интерполяции для чужого курсора допустима.
 */
import type { BoardAwarenessBroadcast } from '@poker/shared';
import { useVueFlow } from '@vue-flow/core';
import { computed } from 'vue';

const props = defineProps<{
  /** Состояние awareness этого участника (курсор/перетаскивание/idle) */
  entry: BoardAwarenessBroadcast;
  /** user_id текущего пользователя — чтобы не рисовать курсор себе */
  selfUserId: string;
}>();

const { viewport } = useVueFlow();

/** Скрываем собственный курсор и курсоры в idle-режиме */
const visible = computed(
  () => props.entry.userId !== props.selfUserId && props.entry.kind !== 'idle',
);

/**
 * Позиция — canvas-координаты, которые сервер ретранслирует как есть. Чтобы
 * нарисовать курсор в правильной точне viewport'а конкретного зрителя,
 * проецируем canvas → viewport через `viewport`.
 */
const style = computed(() => {
  if (!visible.value || !props.entry.data) return { display: 'none' };
  const { x, y } = props.entry.data as { x: number; y: number };
  const zoom = viewport.value.zoom;
  return {
    left: `${viewport.value.x + x * zoom}px`,
    top: `${viewport.value.y + y * zoom}px`,
    transform: 'translate(-50%, -50%)',
  };
});
</script>

<template>
  <div v-show="visible" :style="style" class="board-cursor" :data-user-id="entry.userId">
    <!-- CSS-курсор: маленький неравносторонний треугольник -->
    <div class="board-cursor-tip" />
    <!-- Имя пользователя рядом с курсором -->
    <div class="board-cursor-name">{{ entry.name }}</div>
  </div>
</template>

<style scoped>
.board-cursor {
  position: absolute;
  z-index: 10;
  pointer-events: none;
  /* Плавное движение чужого курсора между throttled-патчами (14.1),
     как и для чужих карточек в BoardCanvas.vue */
  transition:
    left 80ms linear,
    top 80ms linear;
}

/* Маленький неравносторонний треугольник — чужой курсор (14.1) */
.board-cursor-tip {
  position: absolute;
  top: 0;
  left: 0;
  transform: translate(-50%, -50%) rotate(25deg);
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 12px solid var(--brand-ink2);
  filter: drop-shadow(0 1px 2px color-mix(in oklch, var(--brand-shadow) 25%, transparent));
}

/* Цветовые вариации курсора по тинту аватарки (board-colors.ts) */
.board-cursor-tip--primary {
  border-bottom-color: var(--ui-primary);
}
.board-cursor-tip--muted {
  border-bottom-color: var(--brand-ink3);
}

/* Имя участника рядом с курсором — чуть меньше шрифтом */
.board-cursor-name {
  position: absolute;
  top: 16px;
  left: 0;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--brand-surface);
  box-shadow: var(--brand-shadow-card);
  font-size: 10px;
  font-weight: 600;
  color: var(--brand-ink2);
  white-space: nowrap;
  pointer-events: none;
  transition:
    left 80ms linear,
    top 80ms linear;
}
</style>
