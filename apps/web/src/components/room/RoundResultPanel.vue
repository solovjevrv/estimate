<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  average: number | null;
  minLabel: string;
  maxLabel: string;
  agreement: number;
  winnerLabel: string | null;
  /**
   * Голоса раунда как есть, независимо от текущего списка участников — тот, кто
   * успел проголосовать и затем вышел из комнаты, не должен пропасть из результата.
   */
  votes: Array<{ participantId: string; name: string; valueLabel: string }>;
}>();

const { t } = useI18n();

const radius = 30;
const circumference = 2 * Math.PI * radius;
const dashOffset = computed(() => circumference * (1 - props.agreement / 100));
</script>

<template>
  <div>
    <h2 class="text-muted mb-[18px] text-sm font-bold tracking-[0.03em] uppercase">
      {{ t('room.resultTitle') }}
    </h2>
    <div class="flex flex-wrap items-center gap-6">
      <div v-if="props.winnerLabel" class="flex flex-col items-center gap-1">
        <span class="text-muted text-xs">{{ t('room.resultWinnerLabel') }}</span>
        <span class="font-heading text-2xl font-extrabold text-[var(--brand-primary-text)]">{{
          props.winnerLabel
        }}</span>
      </div>

      <div class="flex flex-col items-center gap-1">
        <div class="relative flex h-[72px] w-[72px] items-center justify-center">
          <svg viewBox="0 0 72 72" class="absolute inset-0 -rotate-90">
            <circle
              cx="36"
              cy="36"
              :r="radius"
              fill="none"
              stroke="currentColor"
              class="text-default opacity-20"
              stroke-width="8"
            />
            <circle
              cx="36"
              cy="36"
              :r="radius"
              fill="none"
              stroke="currentColor"
              class="text-primary"
              stroke-width="8"
              stroke-linecap="round"
              :stroke-dasharray="circumference"
              :stroke-dashoffset="dashOffset"
            />
          </svg>
          <span class="relative text-sm font-semibold">{{ props.agreement }}%</span>
        </div>
        <span class="text-muted text-xs">
          {{ t('room.resultAgreement', { agreement: props.agreement }) }}
        </span>
      </div>

      <div class="text-muted flex flex-col gap-1 text-sm">
        <span v-if="props.average !== null">
          {{ t('room.resultAverage', { average: props.average }) }}
        </span>
        <span>{{ t('room.resultMin', { min: props.minLabel }) }}</span>
        <span>{{ t('room.resultMax', { max: props.maxLabel }) }}</span>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <span v-for="v in props.votes" :key="v.participantId" class="badge-pill badge-pill-neutral">
        {{ v.name }}: {{ v.valueLabel }}
      </span>
    </div>
  </div>
</template>
