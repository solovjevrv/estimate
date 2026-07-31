import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GuestSessions } from '../src/rooms';

const SECRET = 'секрет-гостевых-сессий-для-тестов-длиннее-32';

describe('GuestSessions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('выдаёт токен, который проходит проверку в той же комнате', () => {
    const guests = new GuestSessions(SECRET);
    const roomId = randomUUID();
    const { guestId, token } = guests.create(roomId);

    expect(guests.verify(roomId, token)).toBe(guestId);
  });

  it('токен, выданный для одной комнаты, не проходит проверку в другой — 6.2', () => {
    const guests = new GuestSessions(SECRET);
    const roomA = randomUUID();
    const roomB = randomUUID();
    const { token } = guests.create(roomA);

    expect(guests.verify(roomB, token)).toBeNull();
  });

  it('токен без подписи или с подделанной подписью отклоняется', () => {
    const guests = new GuestSessions(SECRET);
    const roomId = randomUUID();
    const { token } = guests.create(roomId);
    const tampered = `${token}x`;

    expect(guests.verify(roomId, tampered)).toBeNull();
    expect(guests.verify(roomId, undefined)).toBeNull();
    expect(guests.verify(roomId, 'мусор')).toBeNull();
  });

  it('токен, подписанный другим секретом, не проходит проверку', () => {
    const roomId = randomUUID();
    const { token } = new GuestSessions(SECRET).create(roomId);

    expect(
      new GuestSessions('другой-секрет-длиннее-тридцати-двух-символов').verify(roomId, token),
    ).toBeNull();
  });

  it('токен любой другой JWT-подобной строки (header.payload.signature) не проходит — регрессия на общий секрет с JWT', () => {
    const guests = new GuestSessions(SECRET);
    const roomId = randomUUID();
    // Формат JWT: три сегмента через точку — раньше при lastIndexOf('.') такое
    // принималось за "guestId.подпись" и проходило проверку тем же секретом
    const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';

    expect(guests.verify(roomId, jwtLike)).toBeNull();
  });

  it('просроченный токен (старше 30 дней) отклоняется — 6.2', () => {
    vi.useFakeTimers();
    const guests = new GuestSessions(SECRET);
    const roomId = randomUUID();
    const { token } = guests.create(roomId);

    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1);
    expect(guests.verify(roomId, token)).toBeNull();
  });

  it('токен в границах TTL остаётся действительным', () => {
    vi.useFakeTimers();
    const guests = new GuestSessions(SECRET);
    const roomId = randomUUID();
    const { guestId, token } = guests.create(roomId);

    vi.advanceTimersByTime(29 * 24 * 60 * 60 * 1000);
    expect(guests.verify(roomId, token)).toBe(guestId);
  });
});
