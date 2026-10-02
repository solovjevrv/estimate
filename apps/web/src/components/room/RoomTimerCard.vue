<script setup lang="ts">
import type { RoomTimerState } from '@estimate/shared';
import { TIMER_DURATION_PRESETS_SEC } from '@estimate/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useCountdown } from '../../composables/use-countdown';

const props = defineProps<{
  timer: RoomTimerState;
  pending: boolean;
}>();

const emit = defineEmits<{ start: []; pause: []; reset: [durationSec: number] }>();

const { t } = useI18n();

const { remainingSec, isExpired, timeLabel } = useCountdown(() => props.timer);

/**
 * SVG-кольцо, а не conic-gradient: background-image (которым красился конус)
 * не входит в анимируемые CSS-свойства спецификации, поэтому transition на
 * него был мёртвым кодом — кольцо дёргалось на каждый тик вместо плавного
 * уменьшения (7.38). stroke-dashoffset анимируется штатно (см. StatRing.vue).
 */
const RING_RADIUS = 34;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const progressFraction = computed(() => {
  if (props.timer.durationSec === 0) return 0;
  return remainingSec.value / props.timer.durationSec;
});

const dashOffset = computed(() => RING_CIRCUMFERENCE * (1 - progressFraction.value));

/**
 * 53_Timer: дуга — surface-brand (тот же зелёный, что у кнопки «Старт», в Dark —
 * brand/on-dark), у истёкшего — border-error; время — text-brand / text-error
 */
const ringColor = computed(() =>
  isExpired.value ? 'var(--border-error)' : 'var(--surface-brand)',
);
const timeColor = computed(() => (isExpired.value ? 'var(--text-error)' : 'var(--text-brand)'));

function presetLabel(durationSec: number): string {
  return t('room.timerMinutes', { minutes: Math.round(durationSec / 60) });
}

function onToggleClick(): void {
  if (props.timer.running) {
    emit('pause');
  } else {
    emit('start');
  }
}
</script>

<template>
  <div
    class="surface-card surface-card-lg flex flex-col items-center gap-4 px-4 py-5 text-center sm:flex-row sm:flex-wrap sm:text-left sm:px-8 sm:py-8"
  >
    <div class="relative flex size-[76px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 76 76" class="absolute inset-0 -rotate-90">
        <circle
          cx="38"
          cy="38"
          :r="RING_RADIUS"
          fill="none"
          stroke="var(--border-medium)"
          stroke-width="8"
        />
        <circle
          cx="38"
          cy="38"
          :r="RING_RADIUS"
          fill="none"
          stroke-width="8"
          stroke-linecap="round"
          class="transition-[stroke-dashoffset,stroke] duration-300"
          :stroke="ringColor"
          :stroke-dasharray="RING_CIRCUMFERENCE"
          :stroke-dashoffset="dashOffset"
        />
      </svg>
      <div
        class="relative flex size-[60px] items-center justify-center rounded-full bg-[var(--brand-surface)]"
      >
        <span class="font-heading text-[14.5px] font-extrabold" :style="{ color: timeColor }">
          {{ timeLabel }}
        </span>
      </div>
    </div>

    <div class="flex min-w-0 flex-col items-center gap-2 sm:items-start">
      <div class="text-text-secondary flex items-center gap-1.5 text-xs font-bold">
        <UIcon name="i-lucide-timer" class="size-3.5" />
        {{ t('room.timerTitle') }}
      </div>
      <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-start">
        <UButton
          size="sm"
          :icon="props.timer.running ? 'i-lucide-pause' : 'i-lucide-play'"
          :disabled="props.pending"
          @click="onToggleClick"
        >
          {{ props.timer.running ? t('room.timerPause') : t('room.timerStart') }}
        </UButton>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="preset in TIMER_DURATION_PRESETS_SEC"
            :key="preset"
            type="button"
            :disabled="props.pending"
            class="rounded-r8 px-2.5 py-2 text-xs leading-[18px] font-bold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            :class="
              props.timer.durationSec === preset
                ? 'bg-surface-brand-low text-text-brand'
                : 'text-text-primary hover:bg-surface-hover cursor-pointer'
            "
            @click="emit('reset', preset)"
          >
            {{ presetLabel(preset) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
