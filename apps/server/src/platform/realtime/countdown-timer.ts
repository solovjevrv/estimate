import { countdownRemainingSec, type CountdownTimerState } from '@estimate/shared';

import { ValidationError } from '../../errors';

export interface CountdownTimerOptions {
  defaultDurationSec: number;
  /** Какие длительности принимает `reset` — у комнаты пресеты, у доски диапазон */
  isValidDuration: (durationSec: number) => boolean;
  /** Потолок остатка для `extend`; без него «+N» не ограничен */
  maxRemainingSec?: number;
}

/**
 * Общий таймер обратного отсчёта на ключ (комнату или доску). Живёт в памяти
 * процесса — как присутствие участников (`PresenceRegistry`), а не в базе: это
 * сиюминутное состояние, а не история. При нескольких инстансах сюда тоже
 * понадобится общий адаптер (см. Epic 8/7.12, долг 10.18).
 */
export class CountdownTimer {
  private readonly byKey = new Map<string, CountdownTimerState>();

  constructor(private readonly options: CountdownTimerOptions) {}

  /** Снимок таймера; заводит дефолтный, если по ключу его ещё не было */
  get(key: string): CountdownTimerState {
    const existing = this.byKey.get(key);
    if (existing) {
      return existing;
    }
    const initial = this.idle(this.options.defaultDurationSec);
    this.byKey.set(key, initial);
    return initial;
  }

  start(key: string): CountdownTimerState {
    const current = this.get(key);
    if (current.running) {
      return current;
    }
    // С нуля отсчитывать нечего — старт без предварительного сброса не двигает время назад
    const remaining = current.remainingSec > 0 ? current.remainingSec : current.durationSec;
    return this.set(key, {
      durationSec: current.durationSec,
      running: true,
      endsAt: new Date(Date.now() + remaining * 1000).toISOString(),
      remainingSec: remaining,
    });
  }

  pause(key: string): CountdownTimerState {
    const current = this.get(key);
    if (!current.running || !current.endsAt) {
      return current;
    }
    return this.set(key, {
      durationSec: current.durationSec,
      running: false,
      endsAt: null,
      remainingSec: countdownRemainingSec(current, Date.now()),
    });
  }

  reset(key: string, durationSec?: number): CountdownTimerState {
    const current = this.get(key);
    const duration = durationSec ?? current.durationSec;
    if (!this.options.isValidDuration(duration)) {
      throw new ValidationError('Недопустимая длительность таймера');
    }
    return this.set(key, this.idle(duration));
  }

  /**
   * Добавляет время к остатку, не меняя длительность (сброс вернёт исходную).
   * У истёкшего бегущего таймера отсчёт возобновляется от текущего момента.
   */
  extend(key: string, addSec: number): CountdownTimerState {
    const current = this.get(key);
    const now = Date.now();
    const cap = this.options.maxRemainingSec ?? Number.POSITIVE_INFINITY;
    const remaining = Math.min(cap, countdownRemainingSec(current, now) + addSec);
    if (current.running) {
      return this.set(key, {
        ...current,
        endsAt: new Date(now + remaining * 1000).toISOString(),
        remainingSec: remaining,
      });
    }
    return this.set(key, { ...current, remainingSec: remaining });
  }

  /** Комната/доска опустела — сиюминутное состояние ей больше не нужно */
  clear(key: string): void {
    this.byKey.delete(key);
  }

  private set(key: string, state: CountdownTimerState): CountdownTimerState {
    this.byKey.set(key, state);
    return state;
  }

  private idle(durationSec: number): CountdownTimerState {
    return { durationSec, running: false, endsAt: null, remainingSec: durationSec };
  }
}
