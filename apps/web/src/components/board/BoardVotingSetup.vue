<script setup lang="ts">
/**
 * Настройка голосования (15.2, кит — BoardVotingSetup): лимиты точек
 * (независимые — предел на элемент упирается в меньший из двух), где голосуем
 * (вся доска / выделенные / фрейм), галочка «запустить таймер». Скоуп по
 * умолчанию — «Выделенные», если перед открытием что-то выделено.
 */
import {
  BOARD_VOTING_DEFAULT_MAX_PER_ITEM,
  BOARD_VOTING_DEFAULT_VOTES,
  BOARD_VOTING_MAX_VOTES,
} from '@estimate/shared';
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

import type {
  BoardVotingScopeChoice,
  BoardVotingScopeOption,
  BoardVotingSetup,
} from '../../features/boards/composables/use-board-voting';

const props = defineProps<{
  scopeOptions: BoardVotingScopeOption[];
  defaultScope: BoardVotingScopeChoice;
  pending: boolean;
}>();

const emit = defineEmits<{ start: [setup: BoardVotingSetup] }>();

const { t } = useI18n();

const form = reactive<BoardVotingSetup>({
  votesPerParticipant: BOARD_VOTING_DEFAULT_VOTES,
  maxPerItem: BOARD_VOTING_DEFAULT_MAX_PER_ITEM,
  scope: props.defaultScope,
  startTimer: true,
});

/** Без выделения «Выделенные элементы» неактивно — подсказка, как ими воспользоваться */
const selectionEmpty = computed(() =>
  props.scopeOptions.some((option) => option.value === 'selected' && option.disabled),
);

function submit(): void {
  emit('start', {
    votesPerParticipant: form.votesPerParticipant || BOARD_VOTING_DEFAULT_VOTES,
    maxPerItem: form.maxPerItem || 1,
    scope: form.scope,
    startTimer: form.startTimer,
  });
}
</script>

<template>
  <div data-testid="board-voting-setup" class="board-voting-setup">
    <div class="text-text-secondary flex items-center gap-1.5 text-xs leading-[18px] font-bold">
      <UIcon name="i-lucide-vote" class="size-4" />
      {{ t('board.voting.setupTitle') }}
    </div>

    <div class="flex gap-3">
      <UFormField :label="t('board.voting.votesPerParticipant')" class="min-w-0 flex-1">
        <UInputNumber
          v-model="form.votesPerParticipant"
          data-testid="board-voting-votes"
          :min="1"
          :max="BOARD_VOTING_MAX_VOTES"
          class="w-full"
        />
      </UFormField>
      <UFormField :label="t('board.voting.maxPerItem')" class="min-w-0 flex-1">
        <UInputNumber
          v-model="form.maxPerItem"
          data-testid="board-voting-max-per-item"
          :min="1"
          :max="BOARD_VOTING_MAX_VOTES"
          class="w-full"
        />
      </UFormField>
    </div>

    <UFormField
      :label="t('board.voting.scope')"
      :help="selectionEmpty ? t('board.voting.scopeHint') : undefined"
    >
      <USelect
        v-model="form.scope"
        data-testid="board-voting-scope"
        :items="scopeOptions"
        class="w-full"
      />
    </UFormField>

    <UCheckbox v-model="form.startTimer" :label="t('board.voting.startTimer')" />

    <UButton
      data-testid="board-voting-start"
      icon="i-lucide-play"
      block
      size="sm"
      :loading="pending"
      @click="submit"
    >
      {{ t('board.voting.start') }}
    </UButton>
  </div>
</template>

<style scoped>
/* BoardVotingSetup: 336, паддинг 16, шаг 16 */
.board-voting-setup {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 336px;
  padding: 16px;
}
</style>
