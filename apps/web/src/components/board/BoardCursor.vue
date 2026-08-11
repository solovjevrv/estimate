<script setup lang="ts">
/**
 * Чужой курсор участника доски (14.1). Позиционируется в world-координатах
 * Vue Flow (как в Miro): курсор рисуется на том же месте у всех участников,
 * независимо от их зума/панорамирования — для этого `BoardCanvas` проецирует
 * координаты через `project()` и передаёт уже готовые canvas-координаты, а
 * тут мы их обратно в viewport через `viewport` из `useVueFlow()`.
 *
 * Цвет курсора берётся от аватарки участника: если есть — извлекаем доминирующий
 * цвет аватарки (аватары на доске могут быть любыми), иначе — акцентный цвет темы.
 * Это даёт визуально различимые курсоры без фиксированной палитры.
 */
import type { BoardAwarenessBroadcast } from '@poker/shared';
import { useVueFlow } from '@vue-flow/core';
import { computed } from 'vue';

import { avatarTint } from '../../lib/board/board-colors';

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
 * нарисовать курсор в правильной точке viewport'а конкретного зрителя,
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

const tint = computed(() => avatarTint(props.entry.avatarUrl));
</script>

<template>
  <div v-show="visible" :style="style" class="board-cursor" :data-user-id="entry.userId">
    <svg
      :class="['board-cursor-icon', `board-cursor-icon--${tint}`]"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 4L20 20M20 4L4 20"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
    <div class="board-cursor-label">
      <span
        v-if="entry.avatarUrl"
        class="board-cursor-avatar"
        :style="{ backgroundImage: `url(${entry.avatarUrl})` }"
      />
      <span class="board-cursor-name">{{ entry.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.board-cursor {
  position: absolute;
  z-index: 10;
  pointer-events: none;
  /* Чужие курсоры не должны конфликтовать с нашими кликами */
}

/* Приблипание: курсор рядом с именем не должен перекрывать их */
.board-cursor-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-ink2);
  filter: drop-shadow(0 1px 2px color-mix(in oklch, var(--brand-shadow) 25%, transparent));
}

.board-cursor-label {
  position: absolute;
  top: 24px;
  left: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--brand-surface);
  box-shadow: var(--brand-shadow-card);
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: var(--brand-ink2);
  pointer-events: none;
}

.board-cursor-avatar {
  display: block;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  border: 1px solid var(--brand-border);
}

.board-cursor-name {
  /* Обрезаем длинные имена, чтобы подпись не выходила за край экрана */
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

/* Цветовые вариации курсора по тинту аватарки (board-colors.ts) */
.board-cursor-icon--ink {
  color: var(--brand-ink2);
}
.board-cursor-icon--primary {
  color: var(--ui-primary);
}
.board-cursor-icon--muted {
  color: var(--brand-ink3);
}
</style>
