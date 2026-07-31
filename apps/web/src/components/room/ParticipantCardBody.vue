<script setup lang="ts">
import type { Participant } from '@poker/shared';
import { useI18n } from 'vue-i18n';

import { teamAvatarColor } from '../../lib/team-roles';

const props = defineProps<{
  participant: Participant;
  isSelf: boolean;
  /** none — раунда нет, voting — идёт голосование (значения скрыты), revealed — карты вскрыты */
  roundStatus: 'none' | 'voting' | 'revealed';
  /** Подпись значения после вскрытия; null — раунда не было или участник не голосовал */
  valueLabel: string | null;
  isWinner: boolean;
}>();

const { t } = useI18n();
</script>

<template>
  <div
    class="flex w-[130px] flex-col items-center gap-2.5"
    :data-winner="props.roundStatus === 'revealed' && props.isWinner ? 'true' : undefined"
  >
    <div class="relative h-[150px] w-[118px]" style="perspective: 800px">
      <div
        class="relative size-full transition-transform duration-500 ease-out [transform-style:preserve-3d]"
        :style="props.roundStatus === 'revealed' ? 'transform: rotateY(180deg)' : ''"
      >
        <!-- Лицо карты: состояние голосования (не вскрыто). В тёмной теме заливка --brand-border
             сама по себе достаточно контрастна к фону страницы — там всё было в порядке. В
             светлой контраста не хватает, поэтому добавляем тонкую обводку явного контрастного
             тона (--brand-ink2, приглушённая прозрачностью); в тёмной обводка не нужна. -->
        <div
          class="absolute inset-0 flex items-center justify-center rounded-[14px] [backface-visibility:hidden]"
          :class="
            props.roundStatus === 'voting' && props.participant.hasVoted
              ? 'bg-[var(--brand-primary-soft-bg)] shadow-[inset_0_0_0_2px_var(--ui-color-primary-500)]'
              : 'bg-[var(--brand-border)] border-[1.5px] border-[var(--brand-ink2)]/45 dark:border-transparent'
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
              : 'bg-[var(--brand-surface)] shadow-[var(--brand-shadow-card)] border-[1.5px] border-[var(--brand-ink2)]/45 dark:border-transparent'
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
