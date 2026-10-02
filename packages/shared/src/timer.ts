/**
 * Общий таймер обратного отсчёта — у комнаты (обсуждение раунда) и у доски
 * (15.3). Живёт в памяти процесса на комнату/доску, а не в базе: это
 * сиюминутное состояние, а не история. Пока идёт отсчёт, `endsAt` —
 * абсолютный момент истечения: клиент считает оставшееся время сам, сверяясь
 * с ним, а не ждёт тиков от сервера каждую секунду.
 */
export interface CountdownTimerState {
  durationSec: number;
  running: boolean;
  /** ISO-момент, когда таймер дойдёт до нуля; null — когда на паузе или сброшен */
  endsAt: string | null;
  /** Остаток в секундах на момент паузы/сброса; во время отсчёта не обновляется — считается от endsAt */
  remainingSec: number;
}

/** Остаток на момент `now`: у бегущего — от `endsAt`, у остановленного — сохранённый */
export function countdownRemainingSec(state: CountdownTimerState, now: number): number {
  if (!state.running || !state.endsAt) {
    return state.remainingSec;
  }
  return Math.max(0, Math.round((Date.parse(state.endsAt) - now) / 1000));
}
