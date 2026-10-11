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

  it('reset принимает свою длительность и отклоняет чужую', async () => {
    const timer = boardLikeTimer();

    expect((await timer.reset(KEY, 1800)).remainingSec).toBe(1800);
    await expect(timer.reset(KEY, 90)).rejects.toThrow(ValidationError);
    await expect(timer.reset(KEY, 7260)).rejects.toThrow(ValidationError);
  });

  it('extend на бегущем таймере сдвигает endsAt, длительность не меняет', async () => {
    const timer = boardLikeTimer();
    await timer.start(KEY);
    vi.advanceTimersByTime(100_000);

    const extended = await timer.extend(KEY, 60);

    expect(extended.running).toBe(true);
    expect(extended.durationSec).toBe(300);
    expect(extended.endsAt).toBe(new Date('2026-10-02T10:06:00.000Z').toISOString());
  });

  it('extend на паузе добавляет к сохранённому остатку', async () => {
    const timer = boardLikeTimer();
    await timer.start(KEY);
    vi.advanceTimersByTime(60_000);
    await timer.pause(KEY);

    expect(await timer.extend(KEY, 60)).toMatchObject({ running: false, remainingSec: 300 });
  });

  it('extend истёкшего таймера возобновляет отсчёт от текущего момента', async () => {
    const timer = boardLikeTimer();
    await timer.reset(KEY, 60);
    await timer.start(KEY);
    vi.advanceTimersByTime(90_000);

    const extended = await timer.extend(KEY, 60);

    expect(extended.endsAt).toBe(new Date('2026-10-02T10:02:30.000Z').toISOString());
  });

  it('extend не поднимает остаток выше потолка', async () => {
    const timer = boardLikeTimer();
    await timer.reset(KEY, 7200);

    expect((await timer.extend(KEY, 60)).remainingSec).toBe(7200);
  });

  it('сброс возвращает исходную длительность после extend', async () => {
    const timer = boardLikeTimer();
    await timer.start(KEY);
    await timer.extend(KEY, 60);

    expect(await timer.reset(KEY)).toMatchObject({
      durationSec: 300,
      running: false,
      endsAt: null,
      remainingSec: 300,
    });
  });

  it('версия растёт с каждым изменением, команда без изменений её не двигает (10.18)', async () => {
    const timer = boardLikeTimer();
    expect((await timer.get(KEY)).version).toBe(0);

    const started = await timer.start(KEY);
    const again = await timer.start(KEY);
    const paused = await timer.pause(KEY);

    expect(started.version).toBeGreaterThan(0);
    expect(again.version).toBe(started.version);
    expect(paused.version).toBeGreaterThan(started.version);
  });

  it('после очистки версия не откатывается назад — клиенты не отбросят новое состояние', async () => {
    const timer = boardLikeTimer();
    const before = await timer.start(KEY);
    await timer.clear(KEY);

    expect((await timer.reset(KEY, 600)).version).toBeGreaterThanOrEqual(before.version);
  });
});
