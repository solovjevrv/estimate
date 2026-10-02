<script setup lang="ts">
/**
 * Панель итогов голосования (15.2, кит — BoardVotingResults) под кнопкой
 * голосования: какое голосование открыто, элементы по убыванию голосов, клик
 * по строке — камера к элементу. Крестик закрывает панель только у себя;
 * «Новое голосование» — у тех, кто может править доску.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  formatVotingDate,
  type BoardVoting,
} from '../../features/boards/composables/use-board-voting';

const props = defineProps<{
  voting: BoardVoting;
  canEdit: boolean;
}>();

const emit = defineEmits<{ focus: [itemId: string] }>();

const { t, locale } = useI18n();

const rows = computed(() => props.voting.resultRows.value);
const shown = computed(() => props.voting.shownResults.value);
const meta = computed(() =>
  t('board.voting.resultsMeta', {
    date: formatVotingDate(shown.value?.closedAt ?? shown.value?.startedAt ?? '', locale.value),
    voters: props.voting.summary.value.voters,
    votes: t('board.voting.votesCount', props.voting.summary.value.votes),
  }),
);
</script>

<template>
  <div
    data-testid="board-voting-results"
    class="board-voting-results surface-card shadow-elevation-2"
  >
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-trophy" class="text-icons-brand size-[18px] shrink-0" />
      <span class="text-text-primary flex-1 text-sm leading-5 font-bold">
        {{ t('board.voting.votingNumber', { number: shown?.number ?? 1 }) }}
      </span>
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        square
        icon="i-lucide-x"
        :aria-label="t('board.voting.closeResults')"
        @click="voting.closeResults()"
      />
    </div>
    <div class="text-text-secondary text-xs leading-[18px] font-medium">{{ meta }}</div>

    <div v-if="rows.length > 0" class="board-voting-results-list">
      <button
        v-for="row in rows"
        :key="row.itemId"
        type="button"
        data-testid="board-voting-result-row"
        class="board-voting-result-row"
        @click="emit('focus', row.itemId)"
      >
        <span class="board-voting-rank">{{ row.rank }}</span>
        <span class="board-voting-swatch" :style="{ background: row.color }" />
        <span class="text-text-primary min-w-0 flex-1 truncate text-left text-xs font-medium">
          {{ row.text }}
        </span>
        <span class="badge-pill badge-pill-primary">{{ row.total }}</span>
      </button>
    </div>
    <div v-else class="text-text-secondary text-xs">{{ t('board.voting.noResults') }}</div>

    <template v-if="canEdit && !voting.isActive.value">
      <div class="border-border-light border-t" />
      <UButton
        data-testid="board-voting-new-from-results"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-plus"
        class="self-start"
        @click="voting.requestNewVoting()"
      >
        {{ t('board.voting.newVoting') }}
      </UButton>
    </template>
  </div>
</template>

<style scoped>
/* BoardVotingResults: 320, паддинг 16, шаг 12, r16 */
.board-voting-results {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 320px;
  max-height: min(480px, calc(100vh - 220px));
  padding: 16px;
  border-radius: 16px;
}

.board-voting-results-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
}

/* BoardVotingResultRow: паддинг 8/10, шаг 10, r8, hover — surface-hover */
.board-voting-result-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.board-voting-result-row:hover {
  background: var(--surface-hover);
}

/* Место: Body/Xsmall/Bold 10/12, text-tertiary */
.board-voting-rank {
  width: 12px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: 10px;
  line-height: 12px;
  font-weight: 700;
}

.board-voting-swatch {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  border-radius: 3px;
}
</style>
