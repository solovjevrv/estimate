<script setup lang="ts">
/**
 * Кнопка «Разложить» в тулбаре выделения (15.4, кит — BoardSelectionToolbar
 * с ShowArrange) вместе с разделителем перед ней — открывает меню
 * раскладки; выбор закрывает меню.
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { BoardArrangeMode } from '../../features/boards/domain/board-arrange';
import BoardArrangeMenu from './BoardArrangeMenu.vue';

defineProps<{ canByVotes: boolean }>();

const emit = defineEmits<{ pick: [mode: BoardArrangeMode] }>();

const { t } = useI18n();
const open = ref(false);

function pick(mode: BoardArrangeMode): void {
  open.value = false;
  emit('pick', mode);
}
</script>

<template>
  <div class="board-selection-divider" />
  <!-- Вниз, поверх выделения (Design — «Раскладка»): вверху меню ушло бы под верхний ряд -->
  <UPopover v-model:open="open" :content="{ side: 'bottom', align: 'start', sideOffset: 8 }">
    <button
      type="button"
      data-testid="board-arrange-button"
      class="board-selection-icon-btn"
      :class="{ 'board-selection-icon-btn-active': open }"
      :aria-label="t('board.arrange.button')"
      :title="t('board.arrange.button')"
    >
      <UIcon name="i-lucide-layout-grid" class="size-3.5" />
    </button>
    <template #content>
      <BoardArrangeMenu :can-by-votes="canByVotes" @pick="pick" />
    </template>
  </UPopover>
</template>

<style scoped>
@import './shared/board-toolbar.css';
</style>
