<script setup lang="ts">
/**
 * Кластер управления снизу-слева — компоненты @vue-flow/controls (не свои
 * кнопки), только переоформлены под токены приложения и в ряд, как в
 * референсе (12.5). Иконки встроенных кнопок (zoom/fit-view) — тоже из пака
 * lucide через именованные слоты Controls, а не сырые SVG библиотеки, для
 * единообразия со всем остальным проектом. show-interactive скрыт:
 * переключает драг/коннект узлов вне нашего UI управления ими. Вынесена из
 * `BoardCanvas.vue` (17.1).
 */
import { ControlButton, Controls } from '@vue-flow/controls';
import { useI18n } from 'vue-i18n';

import '@vue-flow/controls/dist/style.css';

defineProps<{
  zoomPercent: number;
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isFullscreen: boolean;
}>();

const emit = defineEmits<{
  undo: [];
  redo: [];
  toggleFullscreen: [];
  help: [];
}>();

const { t } = useI18n();
</script>

<template>
  <Controls class="board-controls" :show-interactive="false">
    <template #icon-zoom-in>
      <UIcon name="i-lucide-plus" />
    </template>
    <template #icon-zoom-out>
      <UIcon name="i-lucide-minus" />
    </template>
    <template #icon-fit-view>
      <UIcon name="i-lucide-maximize" />
    </template>
    <span data-testid="board-zoom" class="board-controls-zoom">{{ zoomPercent }}%</span>
    <div class="board-controls-divider" />
    <!-- Undo/redo (12.10) — только для тех, кто вообще может редактировать содержимое -->
    <template v-if="canEdit">
      <ControlButton :disabled="!canUndo" :aria-label="t('board.undo')" @click="emit('undo')">
        <UIcon name="i-lucide-undo-2" />
      </ControlButton>
      <ControlButton :disabled="!canRedo" :aria-label="t('board.redo')" @click="emit('redo')">
        <UIcon name="i-lucide-redo-2" />
      </ControlButton>
      <div class="board-controls-divider" />
    </template>
    <!-- i-lucide-expand/shrink, не i-lucide-maximize/minimize — тот символ уже занят
    fit-view выше, а это разные действия: fitview подгоняет зум/пан под содержимое
    холста, fullscreen разворачивает окно браузера (нужен свой, отличимый символ) -->
    <ControlButton
      :aria-label="t(isFullscreen ? 'board.exitFullscreen' : 'board.fullscreen')"
      @click="emit('toggleFullscreen')"
    >
      <UIcon :name="isFullscreen ? 'i-lucide-shrink' : 'i-lucide-expand'" />
    </ControlButton>
    <div class="board-controls-divider" />
    <!-- Список хоткеев (22.9) — дискаверабилити: Shift/Alt-режимы при драге
    и остальные хоткеи иначе никак не видны пользователю в UI -->
    <ControlButton :aria-label="t('board.hotkeysButton')" @click="emit('help')">
      <UIcon name="i-lucide-circle-help" />
    </ControlButton>
  </Controls>
</template>

<style scoped>
/*
 * Переоформление кластера @vue-flow/controls под токены приложения и в ряд
 * (референс `.design/main.html`, экран "Доска") — сами кнопки и их клики
 * остаются библиотечными, здесь только внешний вид (12.5). Без :deep() — класс
 * "board-controls" оседает прямо на корневом узле Controls (fallthrough), это
 * тот же элемент, что и .vue-flow__controls, а не его родитель.
 */
.board-controls {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  padding: 6px;
  background: var(--brand-surface);
  border-radius: 14px;
  box-shadow: var(--brand-shadow-card);
}

.board-controls :deep(.vue-flow__controls-button) {
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--brand-ink);
}

.board-controls :deep(.vue-flow__controls-button:hover) {
  background: var(--ui-bg-elevated);
}

/* Библиотечный disabled-стиль (style.css пакета) гасит fill-opacity — не работает для
   контурных (stroke) иконок lucide, поэтому гасим саму кнопку */
.board-controls :deep(.vue-flow__controls-button:disabled) {
  opacity: 0.4;
}

.board-controls :deep(.vue-flow__controls-button svg) {
  max-width: 16px;
  max-height: 16px;
}

.board-controls-zoom {
  min-width: 38px;
  padding: 0 6px;
  color: var(--brand-ink2);
  font-size: 12.5px;
  font-weight: 700;
  text-align: center;
}

.board-controls-divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--brand-border);
}
</style>
