<script setup lang="ts">
/**
 * Плавающий тулбар над выделением (12.6) — чехол/позиционирование по
 * референсу `.design/main.html` (плашка над стикером: `bottom:calc(100% + 12px)`,
 * radius 12, padding 7px 8px). Порядок слоёв (front/back) в макете живёт в
 * ещё не реализованном контекстном меню (12.9) — временно здесь, т.к. это
 * единственная UI-поверхность выделения, которая уже существует; настройка
 * шрифта из макета вынесена в отдельную будущую задачу (решение пользователя
 * 06.08.2026, см. 12.9 в PROGRESS.md) — «Дублировать» не входит в объём 12.6.
 */
import { BOARD_COLOR_TOKENS, type BoardColorToken } from '@poker/shared';
import { useI18n } from 'vue-i18n';

import { BOARD_COLOR_CLASSES } from '../../lib/board/board-colors';

defineProps<{
  /** Экранные координаты верхней границы выделения — толбар рисуется над ними */
  left: number;
  top: number;
}>();

const emit = defineEmits<{
  color: [token: BoardColorToken];
  bringToFront: [];
  sendToBack: [];
  delete: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    class="board-selection-toolbar"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @click.stop
    @dblclick.stop
  >
    <button
      v-for="token in BOARD_COLOR_TOKENS"
      :key="token"
      type="button"
      class="board-selection-swatch"
      :class="BOARD_COLOR_CLASSES[token]"
      :aria-label="t(`board.colors.${token}`)"
      @click="emit('color', token)"
    />
    <div class="board-selection-divider" />
    <button
      type="button"
      class="board-selection-icon-btn"
      :aria-label="t('board.bringToFront')"
      @click="emit('bringToFront')"
    >
      <UIcon name="i-lucide-bring-to-front" class="size-3.5" />
    </button>
    <button
      type="button"
      class="board-selection-icon-btn"
      :aria-label="t('board.sendToBack')"
      @click="emit('sendToBack')"
    >
      <UIcon name="i-lucide-send-to-back" class="size-3.5" />
    </button>
    <div class="board-selection-divider" />
    <button
      type="button"
      class="board-selection-icon-btn board-selection-icon-btn-danger"
      :aria-label="t('board.deleteSelected')"
      @click="emit('delete')"
    >
      <UIcon name="i-lucide-trash-2" class="size-3.5" />
    </button>
  </div>
</template>

<style scoped>
.board-selection-toolbar {
  position: absolute;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 7px 8px;
  white-space: nowrap;
  background: var(--brand-surface);
  border-radius: 12px;
  box-shadow: var(--brand-shadow-card);
  transform: translate(-50%, calc(-100% - 12px));
}

.board-selection-swatch {
  box-sizing: border-box;
  width: 20px;
  height: 20px;
  margin: 0 3px;
  cursor: pointer;
  border-radius: 50%;
  border-width: 2px;
}

.board-selection-divider {
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: var(--brand-border);
}

.board-selection-icon-btn {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  color: var(--brand-ink);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 8px;
}

.board-selection-icon-btn:hover {
  background: var(--ui-bg-elevated);
}

.board-selection-icon-btn-danger {
  color: var(--brand-coral);
}

.board-selection-icon-btn-danger:hover {
  background: color-mix(in oklch, var(--brand-coral) 12%, transparent);
}
</style>
