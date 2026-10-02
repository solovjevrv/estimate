<script setup lang="ts">
/**
 * Плашка «идёт голосование» сверху по центру (15.2, кит — BoardVotingBar):
 * свой остаток точек и сколько участников уже проголосовали. У тех, кто
 * может править доску, — «Отменить» и «Завершить».
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { BoardVoting } from '../../features/boards/composables/use-board-voting';

const props = defineProps<{
  voting: BoardVoting;
  canEdit: boolean;
  /** Сколько участников сейчас на доске — «проголосовали N из M» */
  participantCount: number;
}>();

const { t } = useI18n();

const state = computed(() => props.voting.state.value);
// Проголосовавший мог уйти с доски — «4 из 3» не показываем
const total = computed(() => Math.max(props.participantCount, state.value?.votedCount ?? 0));
</script>

<template>
  <div
    v-if="state"
    data-testid="board-voting-bar"
    class="board-voting-bar surface-card shadow-elevation-2"
  >
    <div class="flex min-w-0 items-center gap-2 text-xs leading-[18px] whitespace-nowrap">
      <UIcon name="i-lucide-vote" class="text-icons-brand size-4 shrink-0" />
      <span class="text-text-brand font-bold">{{ t('board.voting.title') }}</span>
      <span data-testid="board-voting-bar-remaining" class="text-text-primary font-bold">
        {{
          t('board.voting.remaining', { left: state.myRemaining, total: state.votesPerParticipant })
        }}
      </span>
      <span class="text-text-secondary font-medium">
        {{ t('board.voting.progress', { voted: state.votedCount, total }) }}
      </span>
    </div>
    <template v-if="canEdit">
      <UButton
        data-testid="board-voting-cancel"
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="voting.pending.value"
        @click="voting.cancel()"
      >
        {{ t('board.voting.cancel') }}
      </UButton>
      <UButton
        data-testid="board-voting-finish"
        icon="i-lucide-circle-check"
        size="sm"
        :disabled="voting.pending.value"
        @click="voting.close()"
      >
        {{ t('board.voting.finish') }}
      </UButton>
    </template>
  </div>
</template>

<style scoped>
/* BoardVotingBar: высота 48, паддинг 8/8/8/16 (без кнопок — 16 справа), шаг 12, r16 */
.board-voting-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 8px 16px;
  border-radius: 16px;
}

.board-voting-bar:has(button) {
  padding-right: 8px;
}
</style>
