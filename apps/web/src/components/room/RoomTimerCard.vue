<script setup lang="ts">
import type { RoomTimerState } from '@estimate/shared';
import { TIMER_DURATION_PRESETS_SEC } from '@estimate/shared';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  timer: RoomTimerState;
  pending: boolean;
}>();

const emit = defineEmits<{ start: []; pause: []; reset: [durationSec: number] }>();

const { t } = useI18n();

/**
 * Сервер шлёт лишь моменты изменения (старт/пауза/сброс), а не тик каждую
 * секунду — остаток на бегущем таймере отсчитываем на клиенте сами, сверяясь
 * с абсолютным `endsAt`. `now` дёргаем раз в секунду только пока идёт отсчёт.
 */
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;

watch(
  () => props.timer.running,
  (running) => {
    if (running && !ticker) {
      now.value = Date.now();
      ticker = setInterval(() => {
        now.value = Date.now();
      }, 250);
    } else if (!running && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker);
});

const remainingSec = computed(() => {
  if (!props.timer.running || !props.timer.endsAt) {
    return props.timer.remainingSec;
  }
  const msLeft = Date.parse(props.timer.endsAt) - now.value;
  return Math.max(0, Math.round(msLeft / 1000));
});

const timeLabel = computed(() => {
  const total = remainingSec.value;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

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

// Время истекло, но пока никто не поставил на паузу/не сбросил — держим на нуле
// и меняем цвет кольца, а не выключаем сами: сброс/пауза — решение участника
const isExpired = computed(() => props.timer.running && remainingSec.value === 0);
const ringColor = computed(() =>
  isExpired.value ? 'var(--brand-coral)' : 'var(--ui-color-primary-500)',
);

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
    class="surface-card surface-card-lg flex flex-col items-center gap-4 px-4 py-5 text-center sm:flex-row sm:flex-wrap sm:text-left sm:px-[30px] sm:py-[26px]"
  >
    <div class="relative flex size-[76px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 76 76" class="absolute inset-0 -rotate-90">
        <circle
          cx="38"
          cy="38"
          :r="RING_RADIUS"
          fill="none"
          stroke="var(--brand-border)"
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
        <span class="font-heading text-[14.5px] font-extrabold" :style="{ color: ringColor }">
          {{ timeLabel }}
        </span>
      </div>
    </div>

    <div class="flex min-w-0 flex-col items-center gap-2 sm:items-start">
      <div
        class="text-muted flex items-center gap-1.5 text-[12.5px] font-bold tracking-[0.03em] uppercase"
      >
        <UIcon name="i-lucide-timer" class="size-3.5" />
        {{ t('room.timerTitle') }}
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
        <UButton
          size="sm"
          :icon="props.timer.running ? 'i-lucide-pause' : 'i-lucide-play'"
          :disabled="props.pending"
          class="rounded-[9px] px-3 py-2 text-[13px] font-bold"
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
            class="rounded-[9px] px-2.5 py-2 text-[12.5px] font-bold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            :class="
              props.timer.durationSec === preset
                ? 'bg-[var(--brand-well-bg)] text-[var(--brand-primary-text)]'
                : 'text-muted cursor-pointer'
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
