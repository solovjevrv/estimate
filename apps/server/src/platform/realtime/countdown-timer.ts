import { countdownRemainingSec, type CountdownTimerState } from '@estimate/shared';

import { ValidationError } from '../../errors';

import { MemoryRealtimeStore, type RealtimeStore } from './realtime-store';

export interface CountdownTimerOptions {
  defaultDurationSec: number;
  /** Какие длительности принимает `reset` — у комнаты пресеты, у доски диапазон */
  isValidDuration: (durationSec: number) => boolean;
  /** Потолок остатка для `extend`; без него «+N» не ограничен */
  maxRemainingSec?: number;
}

/**
 * Общий таймер обратного отсчёта на ключ (комнату или доску). Сиюминутное
 * состояние, а не история — живёт в `RealtimeStore` (10.18): в памяти процесса
 * или в Redis, общем для всех экземпляров сервера. Команды с разных
 * экземпляров применяются атомарно, одна поверх другой (см. `update`).
 */
export class CountdownTimer {
  constructor(
    private readonly options: CountdownTimerOptions,
    private readonly store: RealtimeStore = new MemoryRealtimeStore(),
    /** Пространство ключей: таймеры комнат и досок не должны пересекаться */
    private readonly namespace = 'timer',
  ) {}

  /** Снимок таймера; дефолтный, если по ключу его ещё не было */
  async get(key: string): Promise<CountdownTimerState> {
    return (
      (await this.store.getJson<CountdownTimerState>(this.storeKey(key))) ??
      this.idle(this.options.defaultDurationSec)
    );
  }

  async start(key: string): Promise<CountdownTimerState> {
    return this.update(key, (current) => {
      if (current.running) {
        return current;
      }
      // С нуля отсчитывать нечего — старт без предварительного сброса не двигает время назад
      const remaining = current.remainingSec > 0 ? current.remainingSec : current.durationSec;
      return {
        durationSec: current.durationSec,
        running: true,
        endsAt: new Date(Date.now() + remaining * 1000).toISOString(),
        remainingSec: remaining,
      };
    });
  }

  async pause(key: string): Promise<CountdownTimerState> {
    return this.update(key, (current) => {
      if (!current.running || !current.endsAt) {
        return current;
      }
      return {
        durationSec: current.durationSec,
        running: false,
        endsAt: null,
        remainingSec: countdownRemainingSec(current, Date.now()),
      };
    });
  }

  async reset(key: string, durationSec?: number): Promise<CountdownTimerState> {
    return this.update(key, (current) => {
      const duration = durationSec ?? current.durationSec;
      if (!this.options.isValidDuration(duration)) {
        throw new ValidationError('Недопустимая длительность таймера');
      }
      return this.idle(duration);
    });
  }

  /**
   * Добавляет время к остатку, не меняя длительность (сброс вернёт исходную).
   * У истёкшего бегущего таймера отсчёт возобновляется от текущего момента.
   */
  async extend(key: string, addSec: number): Promise<CountdownTimerState> {
    return this.update(key, (current) => {
      const now = Date.now();
      const cap = this.options.maxRemainingSec ?? Number.POSITIVE_INFINITY;
      const remaining = Math.min(cap, countdownRemainingSec(current, now) + addSec);
      if (current.running) {
        return {
          ...current,
          endsAt: new Date(now + remaining * 1000).toISOString(),
          remainingSec: remaining,
        };
      }
      return { ...current, remainingSec: remaining };
    });
  }

  /** Комната/доска опустела — сиюминутное состояние ей больше не нужно */
  async clear(key: string): Promise<void> {
    await this.store.delete(this.storeKey(key));
  }

  /**
   * Команды с разных экземпляров не затирают друг друга (10.18): изменение
   * атомарно, при одновременной правке команда перечитывает и применяется
   * поверх свежего состояния — в итоге действуют обе, в порядке записи
   */
  private update(
    key: string,
    command: (current: CountdownTimerState) => CountdownTimerState,
  ): Promise<CountdownTimerState> {
    return this.store.updateJson<CountdownTimerState>(this.storeKey(key), (stored) =>
      command(stored ?? this.idle(this.options.defaultDurationSec)),
    );
  }

  /** Ключ в хранилище — для атомарной очистки опустевшей комнаты/доски */
  storeKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private idle(durationSec: number): CountdownTimerState {
    return { durationSec, running: false, endsAt: null, remainingSec: durationSec };
  }
}
