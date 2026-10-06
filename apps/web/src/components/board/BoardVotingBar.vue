<script setup lang="ts">
/**
 * Карточка «идёт голосование» под кнопкой в правом верхнем ряду (15.2, кит —
 * BoardVotingBar, 320 — как панель итогов): подсказка, свой остаток точек и
 * сколько участников уже проголосовали; крестик сворачивает её у себя. У
 * тех, кто может править доску, — «Отменить» и «Завершить»; если не все
 * потратили свои точки, «Завершить» сначала спрашивает подтверждение.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { BoardVoting } from '../../features/boards/composables/use-board-voting';
import ConfirmModal from '../ConfirmModal.vue';

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
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-vote" class="text-icons-brand size-[18px] shrink-0" />
      <span class="text-text-primary flex-1 text-sm leading-5 font-bold">
        {{ t('board.voting.barTitle') }}
      </span>
      <UButton
        data-testid="board-voting-bar-collapse"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        icon="i-lucide-x"
        :aria-label="t('board.voting.collapseBar')"
        @click="voting.toggleBar()"
      />
    </div>
    <div class="text-text-secondary text-xs leading-[18px] font-medium">
      {{ t('board.voting.hint') }}
    </div>
    <div class="flex flex-wrap gap-x-1 text-xs leading-[18px]">
      <span
        v-if="state.myRemaining !== null"
        data-testid="board-voting-bar-remaining"
        class="text-text-primary font-bold"
      >
        {{
          t('board.voting.remaining', {
            left: state.myRemaining,
            total: state.votesPerParticipant ?? 0,
          })
        }}
      </span>
      <span class="text-text-secondary font-medium">
        {{ t('board.voting.progress', { voted: state.votedCount, total }) }}
      </span>
    </div>
    <div v-if="canEdit" class="flex gap-2">
      <UButton
        data-testid="board-voting-cancel"
        color="neutral"
        variant="outline"
        size="sm"
        block
        class="flex-1"
        :disabled="voting.pending.value"
        @click="voting.cancel()"
      >
        {{ t('board.voting.cancel') }}
      </UButton>
      <UButton
        data-testid="board-voting-finish"
        icon="i-lucide-circle-check"
        size="sm"
        block
        class="flex-1"
        :disabled="voting.pending.value"
        @click="voting.finish()"
      >
        {{ t('board.voting.finish') }}
      </UButton>
    </div>
  </div>
  <ConfirmModal
    :open="voting.confirmFinishOpen.value"
    :title="t('board.voting.finishTitle')"
    :description="t('board.voting.finishDescription', voting.finishStats.value)"
    :confirm-label="t('board.voting.finish')"
    :cancel-label="t('board.voting.continueVoting')"
    confirm-color="primary"
    :loading="voting.pending.value"
    @update:open="voting.setConfirmFinishOpen"
    @confirm="voting.confirmFinish()"
  />
</template>

<style scoped>
/* BoardVotingBar: карточка 320, паддинг 16, шаг 12, r16 — как BoardVotingResults */
.board-voting-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 320px;
  padding: 16px;
  border-radius: 16px;
}
</style>
