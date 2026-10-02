<script setup lang="ts">
/**
 * Кнопка голосования в правом верхнем ряду (15.2, кит — BoardVotingButton),
 * между таймером и панелью участников. До старта — у тех, кто может править
 * доску, открывает настройку; во время голосования — остаток своих точек;
 * после — «Итоги», сворачивает и разворачивает панель итогов.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { BoardVoting } from '../../features/boards/composables/use-board-voting';
import BoardVotingSetup from './BoardVotingSetup.vue';

const props = defineProps<{
  voting: BoardVoting;
  canEdit: boolean;
}>();

const { t } = useI18n();

const setupOpen = ref(false);
const phase = computed(() =>
  props.voting.isActive.value ? 'active' : props.voting.hasResults.value ? 'results' : 'idle',
);
const visible = computed(() => props.canEdit || phase.value !== 'idle');

async function onStart(setup: Parameters<BoardVoting['start']>[0]): Promise<void> {
  if (await props.voting.start(setup)) setupOpen.value = false;
}
</script>

<template>
  <template v-if="visible">
    <UPopover
      v-if="phase === 'idle'"
      v-model:open="setupOpen"
      :content="{ side: 'bottom', align: 'end', sideOffset: 8 }"
      :ui="{ content: 'rounded-r16' }"
    >
      <button
        type="button"
        data-testid="board-voting-button"
        data-phase="idle"
        class="board-voting-button surface-card shadow-elevation-2"
      >
        <UIcon name="i-lucide-vote" class="text-icons-secondary size-5" />
        <span class="text-text-primary">{{ t('board.voting.button') }}</span>
      </button>
      <template #content>
        <BoardVotingSetup
          :scope-options="voting.scopeOptions.value"
          :default-scope="voting.defaultScope.value"
          :pending="voting.pending.value"
          @start="onStart"
        />
      </template>
    </UPopover>

    <div
      v-else-if="phase === 'active'"
      data-testid="board-voting-button"
      data-phase="active"
      class="board-voting-button surface-card shadow-elevation-2"
    >
      <UIcon name="i-lucide-vote" class="text-icons-brand size-5" />
      <span class="text-text-brand">{{ t('board.voting.button') }}</span>
      <span data-testid="board-voting-remaining" class="board-voting-remaining">
        {{
          t('board.voting.remainingShort', {
            left: voting.state.value?.myRemaining ?? 0,
            total: voting.state.value?.votesPerParticipant ?? 0,
          })
        }}
      </span>
    </div>

    <button
      v-else
      type="button"
      data-testid="board-voting-button"
      data-phase="results"
      class="board-voting-button surface-card shadow-elevation-2"
      :aria-pressed="voting.resultsOpen.value"
      @click="voting.toggleResults()"
    >
      <UIcon name="i-lucide-trophy" class="text-icons-brand size-5" />
      <span class="text-text-brand">{{ t('board.voting.results') }}</span>
    </button>
  </template>
</template>

<style scoped>
/* BoardVotingButton: высота 54, паддинг 10/16, шаг 8, r20 — вровень с таймером */
.board-voting-button {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 54px;
  padding: 10px 16px;
  border-radius: 20px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 700;
  white-space: nowrap;
}

button.board-voting-button {
  cursor: pointer;
}

.board-voting-remaining {
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--text-brand);
  background: var(--surface-brand-low);
  font-size: 12px;
  line-height: 18px;
}
</style>
