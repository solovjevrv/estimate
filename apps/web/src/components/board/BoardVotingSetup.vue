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
  /** Сколько элементов выделено сейчас — меняется на лету, пока настройка открыта */
  selectedCount: number;
  pending: boolean;
}>();

const emit = defineEmits<{ start: [setup: BoardVotingSetup]; close: [] }>();

const { t } = useI18n();

const form = reactive({
  votesPerParticipant: BOARD_VOTING_DEFAULT_VOTES,
  maxPerItem: BOARD_VOTING_DEFAULT_MAX_PER_ITEM,
  /** «Без ограничения» — не оба сразу: вторая галочка блокируется */
  votesUnlimited: false,
  // По умолчанию на один элемент — без ограничения: упрёшься только в свои 3 точки
  perItemUnlimited: true,
  scope: props.defaultScope,
  startTimer: true,
});

/** «Выделенные» без выделения: подсказка, как выделить, и старт недоступен */
const waitingForSelection = computed(() => form.scope === 'selected' && props.selectedCount === 0);

function submit(): void {
  const setup: BoardVotingSetup = {
    votesPerParticipant: form.votesUnlimited
      ? null
      : form.votesPerParticipant || BOARD_VOTING_DEFAULT_VOTES,
    maxPerItem: form.perItemUnlimited ? null : form.maxPerItem || 1,
    scope: form.scope,
    startTimer: form.startTimer,
  };
  emit('start', setup);
}
</script>

<template>
  <div data-testid="board-voting-setup" class="board-voting-setup" @keydown.esc="emit('close')">
    <div class="text-text-secondary flex items-center gap-1.5 text-xs leading-[18px] font-bold">
      <UIcon name="i-lucide-vote" class="size-4" />
      {{ t('board.voting.setupTitle') }}
    </div>

    <div class="flex gap-3">
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <UFormField :label="t('board.voting.votesPerParticipant')">
          <UInputNumber
            v-model="form.votesPerParticipant"
            data-testid="board-voting-votes"
            :min="1"
            :max="BOARD_VOTING_MAX_VOTES"
            :disabled="form.votesUnlimited"
            class="w-full"
          />
        </UFormField>
        <UTooltip :text="form.perItemUnlimited ? t('board.voting.needOneLimit') : undefined">
          <UCheckbox
            v-model="form.votesUnlimited"
            data-testid="board-voting-votes-unlimited"
            size="sm"
            :label="t('board.voting.unlimited')"
            :disabled="form.perItemUnlimited"
          />
        </UTooltip>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <UFormField :label="t('board.voting.maxPerItem')">
          <UInputNumber
            v-model="form.maxPerItem"
            data-testid="board-voting-max-per-item"
            :min="1"
            :max="BOARD_VOTING_MAX_VOTES"
            :disabled="form.perItemUnlimited"
            class="w-full"
          />
        </UFormField>
        <UTooltip :text="form.votesUnlimited ? t('board.voting.needOneLimit') : undefined">
          <UCheckbox
            v-model="form.perItemUnlimited"
            data-testid="board-voting-per-item-unlimited"
            size="sm"
            :label="t('board.voting.unlimited')"
            :disabled="form.votesUnlimited"
          />
        </UTooltip>
      </div>
    </div>

    <UFormField
      :label="t('board.voting.scope')"
      :help="waitingForSelection ? t('board.voting.scopeHint') : undefined"
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
      :disabled="waitingForSelection"
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
