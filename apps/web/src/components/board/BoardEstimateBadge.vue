<script setup lang="ts">
/**
 * Оценка из покер-комнаты на элементе (15.6, кит — BoardEstimateBadge): тот же
 * слот и вид, что у итога голосования точками (правый нижний угол, пилюля
 * surface-block), вместо точки — пика. «♠ —» — комната есть, карты ещё не
 * вскрывали. Пока идёт голосование точками или открыты его итоги — угол за
 * точками, бейдж оценки скрыт (`estimateFor`). Клик — комната в новой вкладке.
 */
import type { BoardItem } from '@estimate/shared';
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';

import { estimateRoomUrl } from '../../features/boards/composables/use-board-estimate';
import { BOARD_ESTIMATE_KEY } from '../../features/boards/context/board-canvas-keys';

const props = defineProps<{ item: BoardItem }>();

const { t } = useI18n();
const context = inject(BOARD_ESTIMATE_KEY, null);
const estimate = computed(() => context?.estimateFor(props.item.id) ?? null);
</script>

<template>
  <a
    v-if="estimate"
    data-testid="board-estimate-badge"
    :data-pending="estimate.value === null ? 'true' : 'false'"
    class="board-estimate-badge nodrag nopan"
    :class="{ 'board-estimate-badge--pending': estimate.value === null }"
    :href="estimateRoomUrl(estimate.roomId)"
    target="_blank"
    rel="noopener"
    :title="
      estimate.value === null ? t('board.estimate.pendingHint') : t('board.estimate.openRoom')
    "
    @pointerdown.stop
    @mousedown.stop
    @dblclick.stop
    @click.stop
  >
    <UIcon name="i-lucide-spade" class="board-estimate-icon" />
    {{ estimate.value ?? '—' }}
  </a>
</template>

<style scoped>
/* Как BoardVoteBadge Total: правый нижний угол внутри листа, пилюля 28,
   surface-block, elevation-1, Body/Small/Bold 12/18, шаг 5 */
.board-estimate-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px 0 8px;
  border-radius: 14px;
  color: var(--text-primary);
  background: var(--surface-block);
  box-shadow: var(--shadow-elevation-1);
  font-size: 12px;
  line-height: 18px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.board-estimate-badge:hover {
  background: var(--surface-hover);
}

.board-estimate-icon {
  width: 14px;
  height: 14px;
  color: var(--icons-brand);
}

.board-estimate-badge--pending {
  color: var(--text-tertiary);
}

.board-estimate-badge--pending .board-estimate-icon {
  color: var(--icons-tertiary);
}
</style>
