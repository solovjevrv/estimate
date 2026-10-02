<script setup lang="ts">
/**
 * Бейдж голосов на элементе (15.2, кит — BoardVoteBadge): правый нижний угол
 * внутри листа — правый верхний занят кнопкой реакции, левый нижний —
 * полученными реакциями. Во время голосования — свои точки (клик снимает
 * одну) и подсветка при наведении, если за элемент можно проголосовать
 * (кит — BoardVoteHover: затемнение, обводка, «+1»); после завершения —
 * общее число с авторами по наведению.
 */
import type { BoardItem } from '@estimate/shared';
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';

import { BOARD_VOTING_KEY } from '../../features/boards/context/board-canvas-keys';
import { teamAvatarColor } from '../../lib/team-roles';

const props = defineProps<{ item: BoardItem }>();

const { t } = useI18n();
const voting = inject(BOARD_VOTING_KEY, null);

const mine = computed(() =>
  voting?.isActive.value ? (voting.state.value?.myVotes[props.item.id] ?? 0) : 0,
);
const canVote = computed(() => voting?.canVoteOn(props.item) ?? false);
const result = computed(() =>
  voting?.hasResults.value
    ? (voting.resultRows.value.find((row) => row.itemId === props.item.id) ?? null)
    : null,
);

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
</script>

<template>
  <div
    v-if="canVote"
    data-testid="board-vote-hover"
    class="board-vote-hover"
    :class="{ 'board-vote-hover--beside-mine': mine > 0 }"
  >
    <span class="board-vote-badge board-vote-badge--preview">+1</span>
  </div>
  <button
    v-if="mine > 0"
    type="button"
    data-testid="board-vote-badge-mine"
    class="board-vote-badge board-vote-badge--mine nodrag nopan"
    :aria-label="t('board.voting.removeVote')"
    :title="t('board.voting.removeVote')"
    @pointerdown.stop
    @mousedown.stop
    @click.stop="voting?.removeVote(props.item.id)"
  >
    {{ mine }}
  </button>
  <UPopover
    v-else-if="result"
    mode="hover"
    :open-delay="150"
    :content="{ side: 'bottom', align: 'start', sideOffset: 8 }"
    :ui="{ content: 'rounded-r12' }"
  >
    <span data-testid="board-vote-badge-total" class="board-vote-badge board-vote-badge--total">
      <span class="board-vote-dot" />
      {{ result.total }}
    </span>
    <template #content>
      <div data-testid="board-vote-authors" class="board-vote-authors">
        <div class="text-text-secondary text-[10px] leading-3 font-bold">
          {{ t('board.voting.votesCount', result.total) }}
        </div>
        <div v-for="author in result.authors" :key="author.participantId" class="board-vote-author">
          <span class="board-vote-avatar" :class="teamAvatarColor(author.participantId)">
            {{ initials(author.name) }}
          </span>
          <span
            class="text-text-primary min-w-0 flex-1 truncate text-xs leading-[18px] font-medium"
          >
            {{ author.name }}
          </span>
          <span class="text-text-secondary text-xs leading-[18px] font-bold">
            {{ author.count }}
          </span>
        </div>
      </div>
    </template>
  </UPopover>
</template>

<style scoped>
.board-vote-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  border-radius: 12px;
  /* Body/Xsmall/Bold 10/12 */
  font-size: 10px;
  line-height: 12px;
  font-weight: 700;
}

/* Свои точки: surface-brand, цифра text-on-brand; клик снимает одну */
.board-vote-badge--mine {
  min-width: 24px;
  padding: 0 7px;
  color: var(--text-on-brand);
  background: var(--surface-brand);
  cursor: pointer;
}

/* Наведение в голосовании (BoardVoteHover): лёгкое затемнение листа, обводка
   border-brand 2px и «+1» в углу — видно только на наведении узла */
.board-vote-hover {
  position: absolute;
  inset: 0;
  z-index: 3;
  border-radius: 6px;
  background: rgb(0 0 0 / 8%);
  box-shadow: 0 0 0 2px var(--border-brand);
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
}

/* Видимость на наведении узла — в BoardCanvas.vue (селектор по .vue-flow__node:hover) */

/* Свои точки уже в углу — «+1» встаёт левее, бейдж своих точек остаётся кликабельным */
.board-vote-hover--beside-mine .board-vote-badge--preview {
  right: 36px;
}

.board-vote-badge--preview {
  min-width: 24px;
  padding: 0 7px;
  color: var(--text-on-brand);
  background: var(--surface-brand);
}

/* Итог: пилюля surface-block с точкой бренда, elevation-1 */
.board-vote-badge--total {
  gap: 4px;
  padding: 0 8px 0 6px;
  color: var(--text-primary);
  background: var(--surface-block);
  box-shadow: var(--shadow-elevation-1);
  cursor: default;
}

.board-vote-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--surface-brand);
}

/* BoardVoteAuthors: 220, паддинг 12, шаг 8 */
.board-vote-authors {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 220px;
  padding: 12px;
}

.board-vote-author {
  display: flex;
  align-items: center;
  gap: 8px;
}

.board-vote-avatar {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
}
</style>
