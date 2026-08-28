<script setup lang="ts">
import { type EmojiSequence, type Participant } from '@estimate/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { teamAvatarColor } from '../../lib/team-roles';
import type { FlyingReaction, ReceivedReaction } from './participant-reactions';

export type { FlyingReaction, ReceivedReaction } from './participant-reactions';

const props = withDefaults(
  defineProps<{
    participant: Participant;
    isSelf: boolean;
    /** none — раунда нет, voting — идёт голосование (значения скрыты), revealed — карты вскрыты */
    roundStatus: 'none' | 'voting' | 'revealed';
    /** Подпись значения после вскрытия; null — раунда не было или участник не голосовал */
    valueLabel: string | null;
    isWinner: boolean;
    receivedReactions: ReceivedReaction[];
    flyingReactions?: FlyingReaction[];
    /** Порядковый номер карточки в сетке — для лёгкого stagger при перевороте (10.12) */
    flipIndex?: number;
  }>(),
  { flyingReactions: () => [], flipIndex: 0 },
);

import EmojiPicker from '../EmojiPicker.vue';

const emit = defineEmits<{ react: [emoji: EmojiSequence] }>();

const { t } = useI18n();

function onPickEmoji(emoji: EmojiSequence, close: () => void): void {
  emit('react', emoji);
  close();
}

/** Каскадный переворот карт при вскрытии — до 8 карточек, дальше задержка не растёт */
const flipStyle = computed(() => {
  const delayMs = props.roundStatus === 'revealed' ? Math.min(props.flipIndex, 8) * 60 : 0;
  return {
    transform: props.roundStatus === 'revealed' ? 'rotateY(180deg)' : undefined,
    transitionDelay: `${delayMs}ms`,
  };
});

/** Короткая вспышка рамки в момент, когда участник отдал голос (10.12) */
const justVoted = ref(false);
let justVotedTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => props.participant.hasVoted,
  (hasVoted, previouslyVoted) => {
    if (hasVoted && !previouslyVoted && props.roundStatus === 'voting') {
      justVoted.value = true;
      if (justVotedTimer) clearTimeout(justVotedTimer);
      justVotedTimer = setTimeout(() => {
        justVoted.value = false;
      }, 500);
    }
  },
);

/**
 * Клик по уже существующему бейджу — как реакция на сообщение в Telegram:
 * у кого её ещё нет — ставит; у кого уже есть — снимает (сервер решает сам,
 * какая это из двух веток, по паре «автор → адресат»).
 */
function onBadgeClick(emoji: EmojiSequence): void {
  emit('react', emoji);
}
</script>

<template>
  <div
    class="flex w-[130px] flex-col items-center gap-2.5"
    :data-winner="props.roundStatus === 'revealed' && props.isWinner ? 'true' : undefined"
  >
    <div
      class="relative h-[150px] w-[118px]"
      style="perspective: 800px"
      :class="{ 'vote-pulse': justVoted }"
    >
      <div
        class="relative size-full transition-transform duration-500 ease-out [transform-style:preserve-3d]"
        :style="flipStyle"
      >
        <!-- Лицо карты: состояние голосования (не вскрыто). -->
        <div
          class="absolute inset-0 flex items-center justify-center rounded-[14px] transition-[background-color,box-shadow] duration-300 [backface-visibility:hidden]"
          :class="
            props.roundStatus === 'voting' && props.participant.hasVoted
              ? 'bg-[var(--brand-primary-soft-bg)] shadow-[inset_0_0_0_2px_var(--ui-color-primary-500)]'
              : 'bg-[var(--brand-border)]'
          "
        >
          <template v-if="props.roundStatus === 'voting'">
            <UIcon
              v-if="!props.participant.hasVoted"
              name="i-lucide-clock"
              class="size-6 animate-pulse"
              style="color: var(--brand-ink2)"
            />
            <span class="sr-only">
              {{ props.participant.hasVoted ? t('room.voted') : t('room.notVoted') }}
            </span>
          </template>
        </div>
        <!-- Обратная сторона: вскрытое значение -->
        <div
          class="absolute inset-0 flex items-center justify-center rounded-[14px] [backface-visibility:hidden] [transform:rotateY(180deg)]"
          :class="
            props.isWinner
              ? 'bg-[var(--brand-primary-soft-bg)] shadow-[inset_0_0_0_2px_var(--ui-color-primary-500)]'
              : 'bg-[var(--brand-surface)] shadow-[var(--brand-shadow-card),inset_0_0_0_1px_var(--brand-border)]'
          "
        >
          <span class="font-heading text-[28px] font-extrabold text-[var(--brand-primary-text)]">
            {{ props.valueLabel }}
          </span>
        </div>
      </div>
      <div
        v-if="props.roundStatus === 'voting' && props.participant.hasVoted"
        class="absolute right-[-8px] bottom-[-8px] flex size-[26px] items-center justify-center rounded-full bg-[var(--ui-color-primary-500)]"
        style="box-shadow: 0 0 0 3px var(--brand-surface)"
      >
        <UIcon name="i-lucide-check" class="size-3.5 text-white" />
      </div>
      <!-- Реакции, полученные этой карточкой (10.10) — противоположный угол от бейджа голосования.
           Каждая уникальная реакция — свой отдельный бейдж (не общий контейнер на всех), как
           реакции на сообщение в Telegram; одинаковые от нескольких участников схлопнуты в один
           бейдж со счётчиком. Бейдж кликабелен на любой карточке, включая свою (10.12): у кого
           реакции ещё нет — ставит её тем же эмодзи, у кого уже есть своя — снимает (выделена рамкой).
           h-[34px]/min-w-[34px] вместо асимметричного px/py — иначе rounded-full на прямоугольнике
           уже/выше самого себя даёт не круг, а таблетку (нашли по скриншоту пользователя); со
           счётчиком бейдж всё равно раздаётся вширь за счёт min-w. -->

      <TransitionGroup
        tag="div"
        name="badge-pop"
        class="absolute bottom-[-10px] left-[-8px] flex max-w-[130px] flex-wrap gap-1"
      >
        <button
          v-for="reaction in props.receivedReactions"
          :key="reaction.emoji"
          type="button"
          :title="reaction.fromNames.join(', ')"
          :aria-label="
            t('room.reactionBadgeLabel', { emoji: reaction.emoji, count: reaction.count })
          "
          class="border-[var(--brand-ink2)]/45 hover:bg-[var(--brand-border)] flex h-[34px] min-w-[34px] cursor-pointer items-center justify-center gap-0.5 rounded-full border-[1.5px] bg-[var(--brand-surface)] px-1 text-[23px] shadow-[var(--brand-shadow-card)] dark:border-transparent"
          :class="
            reaction.reactedByMe ? 'shadow-[inset_0_0_0_2px_var(--ui-color-primary-500)]' : ''
          "
          @click.stop="onBadgeClick(reaction.emoji)"
        >
          {{ reaction.emoji }}
          <span v-if="reaction.count > 1" class="text-muted text-xs leading-none font-bold">
            {{ reaction.count }}
          </span>
        </button>
      </TransitionGroup>
      <!-- «Вылетающий» эмодзи над карточкой в момент простановки реакции (10.12, Meet-style) —
           отдельно от постоянного бейджа-счётчика выше; сам себя убирает по таймеру в RoomPage. -->
      <div
        v-if="props.flyingReactions.length > 0"
        class="pointer-events-none absolute inset-0 overflow-visible"
      >
        <span
          v-for="reaction in props.flyingReactions"
          :key="reaction.id"
          class="fly-emoji absolute bottom-2 left-1/2 text-4xl"
        >
          {{ reaction.emoji }}
        </span>
      </div>
      <!-- Отправить реакцию — доступно на любой карточке, включая свою, в любой момент раунда (10.10) -->
      <UPopover :content="{ side: 'top' }">
        <button
          type="button"
          class="border-[var(--brand-ink2)]/45 absolute -top-1 -right-1 flex size-[22px] cursor-pointer items-center justify-center rounded-full border-[1.5px] bg-[var(--brand-surface)] shadow-[var(--brand-shadow-card)] dark:border-transparent"
          :aria-label="t('room.reactionTriggerLabel', { name: participant.name })"
          @click.stop
        >
          <UIcon name="i-lucide-smile-plus" class="size-3.5" style="color: var(--brand-ink2)" />
        </button>

        <template #content="{ close }">
          <EmojiPicker
            initially-collapsed
            @select="
              (emoji) => {
                onPickEmoji(emoji, close);
              }
            "
          />
        </template>
      </UPopover>
      <UAvatar
        :src="props.participant.avatarUrl ?? undefined"
        :alt="props.participant.name"
        class="absolute -top-5 left-1/2 size-12 -translate-x-1/2"
        :class="teamAvatarColor(props.participant.participantId)"
        :ui="{ fallback: 'font-heading text-[15px] font-bold text-white uppercase' }"
        style="box-shadow: 0 0 0 3px var(--brand-surface)"
      />
    </div>
    <div class="text-center">
      <p class="truncate text-sm font-bold">
        {{ props.participant.name }}
        <span v-if="props.isSelf" class="text-muted font-normal">{{ t('room.you') }}</span>
      </p>
      <p class="text-muted text-xs">
        {{ participant.role === 'scrum_master' ? t('room.roleScrumMaster') : t('room.roleVoter') }}
      </p>
      <span
        v-if="props.participant.isGuest"
        class="badge-pill badge-pill-neutral mt-1 inline-block"
      >
        {{ t('room.guestBadge') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.badge-pop-enter-active,
.badge-pop-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}
.badge-pop-enter-from,
.badge-pop-leave-to {
  opacity: 0;
  transform: scale(0.5);
}
.badge-pop-leave-active {
  position: absolute;
}

.fly-emoji {
  animation: fly-emoji-rise 1.8s ease-out forwards;
}

@keyframes fly-emoji-rise {
  0% {
    transform: translate(-50%, 0) scale(0.4);
    opacity: 0;
  }
  15% {
    transform: translate(-50%, -18px) scale(1.25);
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -150px) scale(1);
    opacity: 0;
  }
}

.vote-pulse {
  animation: vote-pulse 0.5s ease-out;
}

@keyframes vote-pulse {
  0% {
    transform: scale(1);
  }
  35% {
    transform: scale(1.08);
  }
  100% {
    transform: scale(1);
  }
}
</style>
