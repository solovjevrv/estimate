/**
 * Остаток общего таймера отсчёта (комната, доска 15.3) на клиенте. Сервер шлёт
 * лишь моменты изменения (старт/пауза/сброс), а не тик каждую секунду —
 * остаток на бегущем таймере отсчитываем сами, сверяясь с абсолютным `endsAt`.
 * `now` дёргается по интервалу только пока идёт отсчёт.
 */
import { countdownRemainingSec, type CountdownTimerState } from '@estimate/shared';
import { computed, onScopeDispose, ref, watch, type ComputedRef } from 'vue';

const TICK_MS = 250;

export function formatCountdown(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function useCountdown(timer: () => CountdownTimerState): {
  remainingSec: ComputedRef<number>;
  /** Бежит, но дошёл до нуля: держим на нуле, пока кто-то не поставит паузу или сбросит */
  isExpired: ComputedRef<boolean>;
  timeLabel: ComputedRef<string>;
} {
  const now = ref(Date.now());
  let ticker: ReturnType<typeof setInterval> | null = null;

  function stop(): void {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  watch(
    () => timer().running,
    (running) => {
      if (running && !ticker) {
        now.value = Date.now();
        ticker = setInterval(() => {
          now.value = Date.now();
        }, TICK_MS);
      } else if (!running) {
        stop();
      }
    },
    { immediate: true },
  );

  onScopeDispose(stop);

  // `endsAt` в зависимостях: «+1 мин» сдвигает его без смены `running`
  const remainingSec = computed(() => countdownRemainingSec(timer(), now.value));
  const isExpired = computed(() => timer().running && remainingSec.value === 0);
  const timeLabel = computed(() => formatCountdown(remainingSec.value));

  return { remainingSec, isExpired, timeLabel };
}
