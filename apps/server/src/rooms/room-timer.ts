import {
  TIMER_DEFAULT_DURATION_SEC,
  TIMER_DURATION_PRESETS_SEC,
  type RoomTimerState,
} from '@poker/shared';

import { ValidationError } from '../errors';

/**
 * Общий таймер обсуждения раунда. Живёт в памяти процесса на комнату —
 * как присутствие участников (`PresenceRegistry`), а не в базе: это сиюминутное
 * состояние стола, а не история. При нескольких инстансах сюда тоже
 * понадобится общий адаптер (см. Epic 8/7.12).
 */
export class RoomTimer {
  private readonly byRoom = new Map<string, RoomTimerState>();

  /** Снимок таймера комнаты; заводит дефолтный, если комната ещё не заводила свой */
  get(roomId: string): RoomTimerState {
    const existing = this.byRoom.get(roomId);
    if (existing) {
      return existing;
    }
    const initial = this.idle(TIMER_DEFAULT_DURATION_SEC);
    this.byRoom.set(roomId, initial);
    return initial;
  }

  start(roomId: string): RoomTimerState {
    const current = this.get(roomId);
    if (current.running) {
      return current;
    }
    // С нуля отсчитывать нечего — старт без предварительного сброса не двигает время назад
    const remaining = current.remainingSec > 0 ? current.remainingSec : current.durationSec;
    const next: RoomTimerState = {
      durationSec: current.durationSec,
      running: true,
      endsAt: new Date(Date.now() + remaining * 1000).toISOString(),
      remainingSec: remaining,
    };
    this.byRoom.set(roomId, next);
    return next;
  }

  pause(roomId: string): RoomTimerState {
    const current = this.get(roomId);
    if (!current.running || !current.endsAt) {
      return current;
    }
    const remaining = Math.max(0, Math.round((Date.parse(current.endsAt) - Date.now()) / 1000));
    const next: RoomTimerState = {
      durationSec: current.durationSec,
      running: false,
      endsAt: null,
      remainingSec: remaining,
    };
    this.byRoom.set(roomId, next);
    return next;
  }

  reset(roomId: string, durationSec?: number): RoomTimerState {
    const current = this.get(roomId);
    const duration = durationSec ?? current.durationSec;
    if (!TIMER_DURATION_PRESETS_SEC.includes(duration)) {
      throw new ValidationError('Недопустимая длительность таймера');
    }
    const next = this.idle(duration);
    this.byRoom.set(roomId, next);
    return next;
  }

  /** Комната опустела — сиюминутное состояние ей больше не нужно */
  clear(roomId: string): void {
    this.byRoom.delete(roomId);
  }

  private idle(durationSec: number): RoomTimerState {
    return { durationSec, running: false, endsAt: null, remainingSec: durationSec };
  }
}
