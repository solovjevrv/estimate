/**
 * Юнит-тесты общего таймера отсчёта в части, которой нет у комнаты: «+N»
 * (15.3) и проверка длительности, переданная параметром. Базовые старт/пауза/
 * сброс покрыты в room-timer.test.ts — у RoomTimer та же реализация.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../src/errors';
import { CountdownTimer } from '../src/platform/realtime';

const KEY = 'board-1';

function boardLikeTimer(): CountdownTimer {
  return new CountdownTimer({
    defaultDurationSec: 300,
    isValidDuration: (sec) => sec >= 60 && sec <= 7200 && sec % 60 === 0,
    maxRemainingSec: 7200,
  });
}

describe('CountdownTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reset принимает свою длительность и отклоняет чужую', () => {
    const timer = boardLikeTimer();

    expect(timer.reset(KEY, 1800).remainingSec).toBe(1800);
    expect(() => timer.reset(KEY, 90)).toThrow(ValidationError);
    expect(() => timer.reset(KEY, 7260)).toThrow(ValidationError);
  });

  it('extend на бегущем таймере сдвигает endsAt, длительность не меняет', () => {
    const timer = boardLikeTimer();
    timer.start(KEY);
    vi.advanceTimersByTime(100_000);

    const extended = timer.extend(KEY, 60);

    expect(extended.running).toBe(true);
    expect(extended.durationSec).toBe(300);
    expect(extended.endsAt).toBe(new Date('2026-10-02T10:06:00.000Z').toISOString());
  });

  it('extend на паузе добавляет к сохранённому остатку', () => {
    const timer = boardLikeTimer();
    timer.start(KEY);
    vi.advanceTimersByTime(60_000);
    timer.pause(KEY);

    expect(timer.extend(KEY, 60)).toMatchObject({ running: false, remainingSec: 300 });
  });

  it('extend истёкшего таймера возобновляет отсчёт от текущего момента', () => {
    const timer = boardLikeTimer();
    timer.reset(KEY, 60);
    timer.start(KEY);
    vi.advanceTimersByTime(90_000);

    const extended = timer.extend(KEY, 60);

    expect(extended.endsAt).toBe(new Date('2026-10-02T10:02:30.000Z').toISOString());
  });

  it('extend не поднимает остаток выше потолка', () => {
    const timer = boardLikeTimer();
    timer.reset(KEY, 7200);

    expect(timer.extend(KEY, 60).remainingSec).toBe(7200);
  });

  it('сброс возвращает исходную длительность после extend', () => {
    const timer = boardLikeTimer();
    timer.start(KEY);
    timer.extend(KEY, 60);

    expect(timer.reset(KEY)).toEqual({
      durationSec: 300,
      running: false,
      endsAt: null,
      remainingSec: 300,
    });
  });
});
