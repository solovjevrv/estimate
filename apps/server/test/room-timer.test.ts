/**
 * Юнит-тесты таймера обсуждения: чистая логика без БД и сокетов.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../src/errors';
import { RoomTimer } from '../src/rooms/room-timer';

const ROOM = 'room-1';

describe('RoomTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('до первого действия отдаёт дефолт: 5 минут, не запущен', () => {
    const timer = new RoomTimer();

    expect(timer.get(ROOM)).toMatchObject({
      durationSec: 300,
      running: false,
      endsAt: null,
      remainingSec: 300,
    });
  });

  it('старт считает endsAt от текущего момента и остатка', () => {
    const timer = new RoomTimer();

    const started = timer.start(ROOM);

    expect(started.running).toBe(true);
    expect(started.endsAt).toBe(new Date('2026-07-27T10:05:00.000Z').toISOString());
  });

  it('повторный старт уже запущенного таймера не двигает endsAt вперёд', () => {
    const timer = new RoomTimer();
    const started = timer.start(ROOM);

    vi.advanceTimersByTime(10_000);
    const again = timer.start(ROOM);

    expect(again).toEqual(started);
  });

  it('пауза фиксирует остаток и снимает endsAt', () => {
    const timer = new RoomTimer();
    timer.start(ROOM);

    vi.advanceTimersByTime(60_000); // прошла минута из пяти

    const paused = timer.pause(ROOM);

    expect(paused).toMatchObject({ running: false, endsAt: null, remainingSec: 240 });
  });

  it('старт после паузы продолжает с зафиксированного остатка, а не с полной длительности', () => {
    const timer = new RoomTimer();
    timer.start(ROOM);
    vi.advanceTimersByTime(60_000);
    timer.pause(ROOM);

    const resumed = timer.start(ROOM);

    expect(resumed.endsAt).toBe(new Date('2026-07-27T10:05:00.000Z').toISOString());
  });

  it('пауза на уже остановленном таймере — не операция', () => {
    const timer = new RoomTimer();

    const paused = timer.pause(ROOM);

    expect(paused).toMatchObject({ running: false, endsAt: null, remainingSec: 300 });
  });

  it('сброс останавливает и возвращает к длительности; можно сменить длительность', () => {
    const timer = new RoomTimer();
    timer.start(ROOM);

    const reset = timer.reset(ROOM, 900);

    expect(reset).toMatchObject({
      durationSec: 900,
      running: false,
      endsAt: null,
      remainingSec: 900,
    });
  });

  it('сброс без длительности сохраняет текущую', () => {
    const timer = new RoomTimer();
    timer.reset(ROOM, 600);

    const reset = timer.reset(ROOM);

    expect(reset).toMatchObject({ durationSec: 600, remainingSec: 600 });
  });

  it('длительность не из пресетов отклоняется', () => {
    const timer = new RoomTimer();

    expect(() => timer.reset(ROOM, 42)).toThrow(ValidationError);
  });

  it('clear убирает состояние — следующий get заводит его заново с дефолтом', () => {
    const timer = new RoomTimer();
    timer.start(ROOM);

    timer.clear(ROOM);

    expect(timer.get(ROOM)).toMatchObject({ running: false, remainingSec: 300 });
  });

  it('состояния разных комнат не пересекаются', () => {
    const timer = new RoomTimer();
    timer.start(ROOM);

    expect(timer.get('другая-комната')).toMatchObject({ running: false, remainingSec: 300 });
  });
});
