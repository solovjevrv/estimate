<script setup lang="ts">
import type { Participant } from '@poker/shared';
import { useI18n } from 'vue-i18n';

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
    class="border-default flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors"
    :class="[
      props.isSelf ? 'ring-primary ring-2' : '',
      props.isWinner ? 'border-warning bg-warning/10' : '',
    ]"
  >
    <UAvatar :src="participant.avatarUrl ?? undefined" :alt="participant.name" size="md" />
    <div class="min-w-0">
      <p class="truncate text-sm font-medium">
        {{ participant.name }}
        <span v-if="props.isSelf" class="text-muted text-xs">{{ t('room.you') }}</span>
      </p>
      <p class="text-muted text-xs">
        {{ participant.role === 'scrum_master' ? t('room.roleScrumMaster') : t('room.roleVoter') }}
      </p>
    </div>
    <UBadge v-if="participant.isGuest" color="neutral" variant="subtle" size="sm">
      {{ t('room.guestBadge') }}
    </UBadge>

    <div
      v-if="props.roundStatus !== 'none'"
      class="flex h-12 w-16 items-center justify-center rounded-md border text-lg font-semibold"
      :class="
        props.roundStatus === 'revealed'
          ? props.isWinner
            ? 'border-warning bg-warning/10 text-warning'
            : 'border-primary bg-primary/5'
          : participant.hasVoted
            ? 'border-primary bg-primary/10'
            : 'border-default border-dashed'
      "
    >
      <template v-if="props.roundStatus === 'revealed'">{{ props.valueLabel }}</template>
      <UIcon v-else-if="participant.hasVoted" name="i-lucide-check" class="text-primary size-5" />
    </div>

    <UBadge
      v-if="props.roundStatus === 'voting'"
      :color="participant.hasVoted ? 'success' : 'neutral'"
      variant="subtle"
      size="sm"
    >
      {{ participant.hasVoted ? t('room.voted') : t('room.notVoted') }}
    </UBadge>
  </div>
</template>
