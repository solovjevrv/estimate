/**
 * Таймером управляет любой участник (решение 27.07.2026) — прав здесь не
 * проверяем, сервер тоже их не проверяет. Три команды (start/pause/reset)
 * разделяют один флаг «идёт запрос»: пока одна в полёте, остальные не уходят
 * на сервер (single-flight в useAsyncAction). Актуальное состояние приходит
 * рассылкой `room_state`, поэтому здесь только флаг «идёт запрос».
 */
import { useToast } from '@nuxt/ui/composables';
import { type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useAsyncAction } from '../../../composables/use-async-action';
import type { useRoomStore } from '../../../stores/room';

export interface UseRoomTimerOptions {
  room: ReturnType<typeof useRoomStore>;
}

export function useRoomTimer(options: UseRoomTimerOptions): {
  timerPending: Readonly<Ref<boolean>>;
  onTimerStart: () => Promise<void>;
  onTimerPause: () => Promise<void>;
  onTimerReset: (durationSec: number) => Promise<void>;
} {
  const { t } = useI18n();
  const toast = useToast();
  const { room } = options;

  const { pending: timerPending, execute: runTimerOperation } = useAsyncAction<
    [() => Promise<void>],
    void
  >({
    run: (operation) => operation(),
    error: () => {
      toast.add({ title: t('room.timerError'), color: 'error' });
    },
  });

  async function onTimerStart(): Promise<void> {
    await runTimerOperation(() => room.startTimer());
  }

  async function onTimerPause(): Promise<void> {
    await runTimerOperation(() => room.pauseTimer());
  }

  async function onTimerReset(durationSec: number): Promise<void> {
    await runTimerOperation(() => room.resetTimer(durationSec));
  }

  return { timerPending, onTimerStart, onTimerPause, onTimerReset };
}
