<script setup lang="ts">
/**
 * «Оценить в покере» в тулбаре выделения (15.6, кит — BoardSelectionToolbar
 * с ShowEstimate) вместе с разделителем перед ней. У одного элемента с уже
 * заведённой комнатой — «Открыть комнату».
 */
import { useI18n } from 'vue-i18n';

import type { BoardEstimateAction } from '../../features/boards/composables/use-board-estimate';

const props = defineProps<{ action: BoardEstimateAction; pending: boolean }>();

const emit = defineEmits<{ run: [] }>();

const { t } = useI18n();
</script>

<template>
  <div class="board-selection-divider" />
  <button
    type="button"
    data-testid="board-estimate-button"
    :data-action="props.action"
    class="board-selection-icon-btn"
    :disabled="props.pending"
    :aria-label="
      props.action === 'open' ? t('board.estimate.openRoom') : t('board.estimate.button')
    "
    :title="props.action === 'open' ? t('board.estimate.openRoom') : t('board.estimate.button')"
    @click="emit('run')"
  >
    <UIcon
      :name="props.action === 'open' ? 'i-lucide-square-arrow-out-up-right' : 'i-lucide-spade'"
      class="size-3.5"
    />
  </button>
</template>

<style scoped>
@import './shared/board-toolbar.css';
</style>
