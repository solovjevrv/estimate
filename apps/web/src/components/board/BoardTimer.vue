<script setup lang="ts">
/**
 * Таймер доски (15.3, кит — BoardTimer): пилюля справа вверху, слева от
 * панели присутствия. Кто может править доску — управляет: кнопка в пилюле
 * (старт/пауза/сброс истёкшего) и поповер по клику на время. Остальные видят
 * только отсчёт, и только пока таймер не в исходном состоянии. Сигнал по нулю
 * получают все (см. `useBoardTimer`), поэтому компонент смонтирован всегда.
 */
import type { BoardTimerState } from '@estimate/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  useBoardTimer,
  type BoardTimerCommands,
} from '../../features/boards/composables/use-board-timer';
import BoardTimerPopover from './BoardTimerPopover.vue';

const props = defineProps<{
  timer: BoardTimerState;
  canControl: boolean;
  commands: BoardTimerCommands;
}>();

const { t } = useI18n();

const { phase, timeLabel, pending, soundEnabled, actions } = useBoardTimer(
  () => props.timer,
  props.commands,
);

const open = ref(false);
/** Поповер выравнивается по правому краю всей пилюли, а не только по кнопке времени */
const pill = ref<HTMLElement | null>(null);
const visible = computed(() => props.canControl || phase.value !== 'idle');

const look = computed(
  () =>
    ({
      idle: {
        icon: 'i-lucide-timer',
        iconClass: 'text-icons-secondary',
        timeClass: 'text-text-primary',
      },
      running: {
        icon: 'i-lucide-timer',
        iconClass: 'text-icons-brand',
        timeClass: 'text-text-brand',
      },
      paused: {
        icon: 'i-lucide-timer',
        iconClass: 'text-icons-secondary',
        timeClass: 'text-text-secondary',
      },
      expired: {
        icon: 'i-lucide-alarm-clock',
        iconClass: 'text-icons-error',
        timeClass: 'text-text-error',
      },
    })[phase.value],
);

/** Кнопка в пилюле: запуск — Primary, пауза и сброс истёкшего — Ghost */
const control = computed(() => {
  switch (phase.value) {
    case 'running':
      return {
        icon: 'i-lucide-pause',
        label: t('board.timer.pause'),
        solid: false,
        run: () => actions.pause(),
      };
    case 'expired':
      return {
        icon: 'i-lucide-rotate-ccw',
        label: t('board.timer.reset'),
        solid: false,
        run: () => actions.reset(),
      };
    case 'paused':
      return {
        icon: 'i-lucide-play',
        label: t('board.timer.resume'),
        solid: true,
        run: () => actions.start(),
      };
    default:
      return {
        icon: 'i-lucide-play',
        label: t('board.timer.start'),
        solid: true,
        run: () => actions.start(),
      };
  }
});
</script>

<template>
  <div
    v-if="visible"
    ref="pill"
    data-testid="board-timer"
    :data-phase="phase"
    class="board-timer surface-card shadow-elevation-2"
    :class="{ 'board-timer--expired': phase === 'expired' }"
  >
    <UPopover
      v-if="canControl"
      v-model:open="open"
      :content="{ side: 'bottom', align: 'end', sideOffset: 8 }"
      :reference="pill ?? undefined"
      :ui="{ content: 'rounded-r16' }"
    >
      <button
        type="button"
        data-testid="board-timer-open"
        class="board-timer-display"
        :aria-label="t('board.timer.open')"
      >
        <UIcon :name="look.icon" class="size-5" :class="look.iconClass" />
        <span class="board-timer-time" :class="look.timeClass">{{ timeLabel }}</span>
      </button>

      <template #content>
        <BoardTimerPopover
          v-model:sound="soundEnabled"
          :phase="phase"
          :time-label="timeLabel"
          :duration-sec="timer.durationSec"
          :pending="pending"
          @start="actions.start()"
          @pause="actions.pause()"
          @reset="(durationSec) => actions.reset(durationSec)"
          @extend="actions.extend()"
        />
      </template>
    </UPopover>
    <div v-else class="board-timer-display">
      <UIcon :name="look.icon" class="size-5" :class="look.iconClass" />
      <span class="board-timer-time" :class="look.timeClass">{{ timeLabel }}</span>
    </div>

    <UButton
      v-if="canControl"
      data-testid="board-timer-control"
      :color="control.solid ? 'primary' : 'neutral'"
      :variant="control.solid ? 'solid' : 'ghost'"
      size="sm"
      square
      :icon="control.icon"
      :aria-label="control.label"
      :title="control.label"
      :disabled="pending"
      @click="control.run()"
    />
  </div>
</template>

<style scoped>
/* BoardTimer: высота 54, паддинг 10/12, шаг 12, r20, elevation/2 (как панель присутствия) */
.board-timer {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 10px 12px;
  border-radius: 20px;
}

.board-timer--expired {
  box-shadow:
    inset 0 0 0 1px var(--border-error),
    var(--shadow-elevation-2);
}

.board-timer-display {
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 8px;
}

button.board-timer-display {
  cursor: pointer;
}

.board-timer-time {
  /* Body/Xlarge/Bold; цифры моноширинные — время не дёргается по ширине каждую секунду */
  font-size: 18px;
  line-height: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
