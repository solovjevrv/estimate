<script setup lang="ts">
/**
 * Поповер управления таймером доски (15.3, кит — BoardTimerPopover). До
 * старта — циферблат с −/+ (своё время 1–120 мин с шагом в минуту) и пресеты;
 * во время отсчёта/на паузе — только остаток, «+1 мин» и сброс.
 */
import {
  BOARD_TIMER_MAX_DURATION_SEC,
  BOARD_TIMER_MIN_DURATION_SEC,
  BOARD_TIMER_PRESETS_SEC,
  BOARD_TIMER_STEP_SEC,
} from '@estimate/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { BoardTimerPhase } from '../../features/boards/composables/use-board-timer';

const props = defineProps<{
  phase: BoardTimerPhase;
  timeLabel: string;
  durationSec: number;
  pending: boolean;
}>();

const sound = defineModel<boolean>('sound', { required: true });

const emit = defineEmits<{
  start: [];
  pause: [];
  reset: [durationSec?: number];
  extend: [];
}>();

const { t } = useI18n();

const isIdle = computed(() => props.phase === 'idle');

const timeClass = computed(
  () =>
    ({
      idle: 'text-text-primary',
      running: 'text-text-brand',
      paused: 'text-text-secondary',
      expired: 'text-text-error',
    })[props.phase],
);

const primary = computed(() => {
  switch (props.phase) {
    case 'running':
      return { label: t('board.timer.pause'), icon: 'i-lucide-pause', action: () => emit('pause') };
    case 'paused':
      return { label: t('board.timer.resume'), icon: 'i-lucide-play', action: () => emit('start') };
    case 'expired':
      return {
        label: t('board.timer.reset'),
        icon: 'i-lucide-rotate-ccw',
        action: () => emit('reset'),
      };
    default:
      return { label: t('board.timer.start'), icon: 'i-lucide-play', action: () => emit('start') };
  }
});

function presetLabel(durationSec: number): string {
  return t('board.timer.minutes', { minutes: durationSec / 60 });
}

function step(direction: 1 | -1): void {
  emit('reset', props.durationSec + direction * BOARD_TIMER_STEP_SEC);
}
</script>

<template>
  <div data-testid="board-timer-popover" class="board-timer-popover">
    <div class="flex items-center justify-between">
      <div class="text-text-secondary flex items-center gap-1.5 text-xs leading-[18px] font-bold">
        <UIcon name="i-lucide-timer" class="size-4" />
        {{ t('board.timer.title') }}
      </div>
      <USwitch v-model="sound" size="sm" :label="t('board.timer.sound')" />
    </div>

    <div class="flex h-12 items-center" :class="isIdle ? 'justify-between' : 'justify-center'">
      <UButton
        v-if="isIdle"
        data-testid="board-timer-decrease"
        color="neutral"
        variant="outline"
        size="md"
        square
        icon="i-lucide-minus"
        :aria-label="t('board.timer.decrease')"
        :disabled="pending || durationSec <= BOARD_TIMER_MIN_DURATION_SEC"
        @click="step(-1)"
      />
      <span
        data-testid="board-timer-dial"
        class="font-heading text-[40px] leading-12 font-bold tabular-nums"
        :class="timeClass"
      >
        {{ timeLabel }}
      </span>
      <UButton
        v-if="isIdle"
        data-testid="board-timer-increase"
        color="neutral"
        variant="outline"
        size="md"
        square
        icon="i-lucide-plus"
        :aria-label="t('board.timer.increase')"
        :disabled="pending || durationSec >= BOARD_TIMER_MAX_DURATION_SEC"
        @click="step(1)"
      />
    </div>

    <div v-if="isIdle" class="flex gap-1">
      <!-- Активный пресет — Primary Soft (зелёный), как у таймера комнаты -->
      <UButton
        v-for="preset in BOARD_TIMER_PRESETS_SEC"
        :key="preset"
        :data-testid="`board-timer-preset-${preset / 60}`"
        :color="durationSec === preset ? 'primary' : 'neutral'"
        :variant="durationSec === preset ? 'soft' : 'ghost'"
        size="sm"
        :aria-pressed="durationSec === preset"
        :disabled="pending"
        @click="emit('reset', preset)"
      >
        {{ presetLabel(preset) }}
      </UButton>
    </div>

    <div class="flex gap-2">
      <UButton
        data-testid="board-timer-primary"
        size="sm"
        block
        class="flex-1"
        :icon="primary.icon"
        :disabled="pending"
        @click="primary.action"
      >
        {{ primary.label }}
      </UButton>
      <UButton
        v-if="!isIdle"
        data-testid="board-timer-extend"
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="pending"
        @click="emit('extend')"
      >
        {{ t('board.timer.addMinute') }}
      </UButton>
      <UButton
        v-if="phase !== 'expired'"
        data-testid="board-timer-reset"
        color="neutral"
        variant="outline"
        size="sm"
        square
        icon="i-lucide-rotate-ccw"
        :aria-label="t('board.timer.reset')"
        :disabled="pending || isIdle"
        @click="emit('reset')"
      />
    </div>
  </div>
</template>

<style scoped>
/* BoardTimerPopover: 336 по ширине, паддинг 16, шаг 16, r16, elevation/3 */
.board-timer-popover {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 336px;
  padding: 16px;
}
</style>
