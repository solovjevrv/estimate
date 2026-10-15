import { countdownRemainingSec, type CountdownTimerState } from '@estimate/shared';

import { ValidationError } from '../../errors';

import { MemoryRealtimeStore, type RealtimeStore } from './realtime-store';

/**
 * Состояние с версией (10.18): версия растёт с каждым изменением атомарно
 * вместе с ним — по ней клиенты отбрасывают рассылки, пришедшие не по порядку
 */
export type VersionedTimerState = CountdownTimerState & { version: number };

/** Без версии — для мест, где таймер едет внутри снимка со своим номером (комната) */
export function withoutVersion(versioned: VersionedTimerState): CountdownTimerState {
  const { durationSec, running, endsAt, remainingSec } = versioned;
  return { durationSec, running, endsAt, remainingSec };
}

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
  async get(key: string): Promise<VersionedTimerState> {
    return (
      (await this.store.getJson<VersionedTimerState>(this.storeKey(key))) ?? {
        ...this.idle(this.options.defaultDurationSec),
        version: 0,
      }
    );
  }

  async start(key: string): Promise<VersionedTimerState> {
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

  async pause(key: string): Promise<VersionedTimerState> {
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

  async reset(key: string, durationSec?: number): Promise<VersionedTimerState> {
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
  async extend(key: string, addSec: number): Promise<VersionedTimerState> {
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
  ): Promise<VersionedTimerState> {
    return this.store.updateJson<VersionedTimerState>(this.storeKey(key), (stored) => {
      const current = stored ?? { ...this.idle(this.options.defaultDurationSec), version: 0 };
      const next = command(current);
      // Команда ничего не поменяла (старт уже идущего) — версия та же, записи нет
      if (next === current) return stored ?? current;
      // Не меньше времени: после очистки опустевшей доски версия не откатится
      return { ...next, version: Math.max(current.version + 1, Date.now()) };
    });
  }

  /** Ключ в хранилище — для атомарной очистки опустевшей комнаты/доски */
  storeKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private idle(durationSec: number): CountdownTimerState {
    return { durationSec, running: false, endsAt: null, remainingSec: durationSec };
  }
}
