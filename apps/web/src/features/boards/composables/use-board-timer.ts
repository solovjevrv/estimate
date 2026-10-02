/**
 * Таймер доски (15.3): фаза виджета, команды и сигнал по нулю. Состояние —
 * в сторе сессии доски (рассылка `board:timer`), здесь только то, что нужно
 * виджету: остаток считается от `endsAt` (`useCountdown`), команды разделяют
 * один флаг «идёт запрос», как у таймера комнаты.
 */
import type { BoardTimerState } from '@estimate/shared';
import { useToast } from '@nuxt/ui/composables';
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useAsyncAction } from '../../../composables/use-async-action';
import { useCountdown } from '../../../composables/use-countdown';
import {
  isTimerSoundEnabled,
  playTimerSound,
  setTimerSoundEnabled,
} from '../infrastructure/timer-sound';

export type BoardTimerPhase = 'idle' | 'running' | 'paused' | 'expired';

export interface BoardTimerCommands {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  reset: (durationSec?: number) => Promise<void>;
  extend: () => Promise<void>;
}

/** Фаза по снимку и остатку: истёкший — бежит, но на нуле; пауза — остаток уже не равен длительности */
export function boardTimerPhase(timer: BoardTimerState, remainingSec: number): BoardTimerPhase {
  if (timer.running) return remainingSec === 0 ? 'expired' : 'running';
  return remainingSec === timer.durationSec ? 'idle' : 'paused';
}

export function useBoardTimer(
  timer: () => BoardTimerState,
  commands: BoardTimerCommands,
): {
  phase: ComputedRef<BoardTimerPhase>;
  timeLabel: ComputedRef<string>;
  pending: Readonly<Ref<boolean>>;
  soundEnabled: Ref<boolean>;
  /** Команды с общим флагом `pending` и тостом при отказе — не бросают */
  actions: BoardTimerCommands;
} {
  const { t } = useI18n();
  const toast = useToast();
  const { remainingSec, isExpired, timeLabel } = useCountdown(timer);

  const phase = computed(() => boardTimerPhase(timer(), remainingSec.value));

  const soundEnabled = ref(isTimerSoundEnabled());
  watch(soundEnabled, setTimerSoundEnabled);

  const { pending, execute } = useAsyncAction<[() => Promise<void>], void>({
    run: (command) => command(),
    error: () => {
      toast.add({ title: t('board.timer.error'), color: 'error' });
    },
  });

  const actions: BoardTimerCommands = {
    start: async () => void (await execute(commands.start)),
    pause: async () => void (await execute(commands.pause)),
    reset: async (durationSec) => void (await execute(() => commands.reset(durationSec))),
    extend: async () => void (await execute(commands.extend)),
  };

  /**
   * Сигнал — только на переходе к нулю у этого зрителя: вошедший на уже
   * истёкший таймер видит красное состояние, но тост не получает. Сигнал у
   * всех на доске, независимо от права управлять таймером.
   */
  watch(isExpired, (expired) => {
    if (!expired) return;
    toast.add({
      title: t('board.timer.expiredTitle'),
      description: t('board.timer.expiredDescription'),
      icon: 'i-lucide-alarm-clock',
      color: 'error',
    });
    if (soundEnabled.value) playTimerSound();
  });

  return { phase, timeLabel, pending, soundEnabled, actions };
}
