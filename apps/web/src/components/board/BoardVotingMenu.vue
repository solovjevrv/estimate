<script setup lang="ts">
/**
 * Меню голосований из кнопки в верхнем ряду (15.2, кит — BoardVotingMenu):
 * «Новое голосование» (у тех, кто может править доску) и прошлые голосования —
 * выбор открывает их итоги.
 */
import type { BoardVotingSummary } from '@estimate/shared';
import { useI18n } from 'vue-i18n';

import { formatVotingDate } from '../../features/boards/composables/use-board-voting';

defineProps<{
  history: BoardVotingSummary[];
  loading: boolean;
  canEdit: boolean;
  /** Голосование, итоги которого сейчас открыты */
  openedId: string | null;
}>();

const emit = defineEmits<{ new: []; open: [votingId: string] }>();

const { t, locale } = useI18n();

function meta(summary: BoardVotingSummary): string {
  return t('board.voting.historyMeta', {
    date: formatVotingDate(summary.closedAt ?? summary.startedAt, locale.value),
    votes: t('board.voting.votesCount', summary.totalVotes),
  });
}
</script>

<template>
  <div data-testid="board-voting-menu" class="board-voting-menu">
    <template v-if="canEdit">
      <button
        type="button"
        data-testid="board-voting-new"
        class="board-voting-menu-item"
        @click="emit('new')"
      >
        <UIcon name="i-lucide-plus" class="text-icons-primary size-4" />
        <span class="text-text-primary text-sm font-medium">{{ t('board.voting.newVoting') }}</span>
      </button>
      <div class="border-border-light my-0.5 border-t" />
    </template>
    <div class="text-text-tertiary px-2.5 pt-1.5 pb-0.5 text-xs leading-[18px] font-bold">
      {{ t('board.voting.pastVotings') }}
    </div>
    <div v-if="loading && history.length === 0" class="px-2.5 py-2">
      <USkeleton class="h-9 w-full" />
    </div>
    <button
      v-for="summary in history"
      :key="summary.id"
      type="button"
      data-testid="board-voting-history-item"
      class="board-voting-history-item"
      :class="{ 'board-voting-history-item--checked': summary.id === openedId }"
      @click="emit('open', summary.id)"
    >
      <span class="flex min-w-0 flex-1 flex-col text-left">
        <span class="board-voting-history-title text-xs leading-[18px] font-bold">
          {{ t('board.voting.votingNumber', { number: summary.number }) }}
        </span>
        <span class="text-text-secondary text-xs leading-[18px] font-medium">
          {{ meta(summary) }}
        </span>
      </span>
      <UIcon
        v-if="summary.id === openedId"
        name="i-lucide-check"
        class="text-icons-brand size-4 shrink-0"
      />
    </button>
  </div>
</template>

<style scoped>
/* BoardVotingMenu: 280, паддинг 6, шаг 4, r16 */
.board-voting-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 280px;
  max-height: 420px;
  padding: 6px;
  overflow-y: auto;
}

.board-voting-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
}

.board-voting-menu-item:hover,
.board-voting-history-item:hover {
  background: var(--surface-hover);
}

/* BoardVotingHistoryItem: паддинг 8/10, шаг 10, r10; выбранное — surface-brand-low */
.board-voting-history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
}

.board-voting-history-title {
  color: var(--text-primary);
}

.board-voting-history-item--checked,
.board-voting-history-item--checked:hover {
  background: var(--surface-brand-low);
}

.board-voting-history-item--checked .board-voting-history-title {
  color: var(--text-brand);
}
</style>
