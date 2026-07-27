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
    <div class="relative h-[150px] w-[118px]">
      <div
        class="absolute inset-0 flex items-center justify-center rounded-[14px]"
        :class="[
          props.roundStatus === 'revealed'
            ? props.isWinner
              ? 'bg-[var(--brand-primary-soft-bg)] shadow-[inset_0_0_0_2px_var(--brand-amber)]'
              : 'surface-card'
            : props.roundStatus === 'voting' && props.participant.hasVoted
              ? 'bg-[var(--brand-primary-soft-bg)] shadow-[inset_0_0_0_2px_var(--ui-color-primary-500)]'
              : 'bg-[var(--brand-border)]',
        ]"
      >
        <template v-if="props.roundStatus === 'voting'">
          <!-- Референс красит иконку в цвет самой карточки (--brand-border) — на месте
               она невидима, видна только за счёт пульсирующей анимации (перенесена в
               9.6). Без анимации берём --brand-outline-border — тот же приглушённый
               "призрачный" эффект, но статично различимый. -->
          <UIcon
            v-if="!props.participant.hasVoted"
            name="i-lucide-clock"
            class="size-6"
            style="color: var(--brand-outline-border)"
          />
          <span class="sr-only">
            {{ props.participant.hasVoted ? t('room.voted') : t('room.notVoted') }}
          </span>
        </template>
        <span
          v-else-if="props.roundStatus === 'revealed'"
          class="font-heading text-[28px] font-extrabold"
          :class="props.isWinner ? 'text-[var(--brand-amber)]' : 'text-[var(--brand-primary-text)]'"
        >
          {{ props.valueLabel }}
        </span>
      </div>
      <div
        v-if="props.roundStatus === 'voting' && props.participant.hasVoted"
        class="absolute right-[-8px] bottom-[-8px] flex size-[26px] items-center justify-center rounded-full bg-[var(--ui-color-primary-500)]"
        style="box-shadow: 0 0 0 3px var(--brand-surface)"
      >
        <UIcon name="i-lucide-check" class="size-3.5 text-white" />
      </div>
      <div
        class="font-heading absolute -top-5 left-1/2 flex size-12 -translate-x-1/2 items-center justify-center rounded-full text-[15px] font-bold text-white"
        :class="teamAvatarColor(props.participant.participantId)"
        style="box-shadow: 0 0 0 3px var(--brand-surface)"
      >
        {{
          props.participant.name
            .split(' ')
            .map((word) => word.charAt(0))
            .join('')
            .slice(0, 2)
            .toUpperCase()
        }}
      </div>
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
