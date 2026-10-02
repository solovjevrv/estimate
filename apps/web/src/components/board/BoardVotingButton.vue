<script setup lang="ts">
/**
 * Кнопка голосования в правом верхнем ряду (15.2, кит — BoardVotingButton),
 * между таймером и панелью участников:
 * - голосований ещё не было — у тех, кто может править доску, открывает настройку;
 * - идёт голосование — остаток своих точек;
 * - голосования уже были — «Голосование ▾»: меню с «Новым голосованием» и
 *   историей, выбор из истории открывает итоги. «Новое голосование» в том же
 *   поповере переключает его на настройку.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type {
  BoardVoting,
  BoardVotingSetup as BoardVotingSetupValue,
} from '../../features/boards/composables/use-board-voting';
import BoardVotingMenu from './BoardVotingMenu.vue';
import BoardVotingSetup from './BoardVotingSetup.vue';

const props = defineProps<{
  voting: BoardVoting;
  canEdit: boolean;
}>();

const { t } = useI18n();

const open = ref(false);
/** Что показывает поповер: меню с историей или настройку нового голосования */
const view = ref<'menu' | 'setup'>('setup');

const phase = computed(() =>
  props.voting.isActive.value ? 'active' : props.voting.hasHistory.value ? 'history' : 'idle',
);
const visible = computed(() => props.canEdit || phase.value !== 'idle');

function onOpenChange(next: boolean): void {
  if (next) {
    view.value = phase.value === 'history' ? 'menu' : 'setup';
    if (view.value === 'menu') void props.voting.loadHistory();
  }
  open.value = next;
}

// «Новое голосование» из панели итогов — открыть настройку здесь
watch(
  () => props.voting.setupRequests.value,
  () => {
    if (!props.canEdit || phase.value === 'active') return;
    view.value = 'setup';
    open.value = true;
  },
);

async function onStart(setup: BoardVotingSetupValue): Promise<void> {
  if (await props.voting.start(setup)) open.value = false;
}

async function onOpenResults(votingId: string): Promise<void> {
  open.value = false;
  await props.voting.openResults(votingId);
}
</script>

<template>
  <template v-if="visible">
    <div
      v-if="phase === 'active'"
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

    <UPopover
      v-else
      :open="open"
      :content="{ side: 'bottom', align: 'end', sideOffset: 8 }"
      :ui="{ content: 'rounded-r16' }"
      @update:open="onOpenChange"
    >
      <button
        type="button"
        data-testid="board-voting-button"
        :data-phase="phase"
        class="board-voting-button surface-card shadow-elevation-2"
      >
        <UIcon name="i-lucide-vote" class="text-icons-secondary size-5" />
        <span class="text-text-primary">{{ t('board.voting.button') }}</span>
        <UIcon
          v-if="phase === 'history'"
          name="i-lucide-chevron-down"
          class="text-icons-secondary size-4"
        />
      </button>
      <template #content>
        <BoardVotingMenu
          v-if="view === 'menu'"
          :history="voting.history.value"
          :loading="voting.historyLoading.value"
          :can-edit="canEdit"
          :opened-id="voting.hasResults.value ? (voting.shownResults.value?.id ?? null) : null"
          @new="view = 'setup'"
          @open="onOpenResults"
        />
        <BoardVotingSetup
          v-else
          :scope-options="voting.scopeOptions.value"
          :default-scope="voting.defaultScope.value"
          :pending="voting.pending.value"
          @start="onStart"
        />
      </template>
    </UPopover>
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

/* Пилюля остатка: Body/Xsmall/Bold 10/12 */
.board-voting-remaining {
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--text-brand);
  background: var(--surface-brand-low);
  font-size: 10px;
  line-height: 12px;
}
</style>
