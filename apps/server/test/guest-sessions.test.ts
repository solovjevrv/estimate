import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type GuestScope, GuestSessions } from '../src/platform/realtime';

const SECRET = 'секрет-гостевых-сессий-для-тестов-длиннее-32';
const OTHER_SECRET = 'другой-секрет-длиннее-тридцати-двух-символов';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SCOPES: GuestScope[] = ['guest', 'boardGuest'];

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Скоуп («комната» / «доска») меняет только доменную метку в подписи, поэтому
 * все свойства модуля должны выполняться в каждом из них одинаково — иначе
 * объединение двух копий в один класс было бы небезопасным.
 */
describe.each(SCOPES)('GuestSessions (scope: %s)', (scope) => {
  const guests = new GuestSessions(SECRET, scope);

  it('выдаёт токен, который проходит проверку в той же сущности', () => {
    const scopeId = randomUUID();
    const { guestId, token } = guests.create(scopeId);

    expect(guestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(token.split('.')[0]).toBe(scopeId);
    expect(token.split('.')[1]).toBe(guestId);
    expect(guests.verify(scopeId, token)).toBe(guestId);
  });

  it('токен, выданный для одной сущности, не проходит проверку в другой — 6.2', () => {
    const { token } = guests.create(randomUUID());

    expect(guests.verify(randomUUID(), token)).toBeNull();
  });

  it('токен без подписи или с подделанной подписью отклоняется', () => {
    const scopeId = randomUUID();
    const { token } = guests.create(scopeId);
    const [id, guestId, issuedAt] = token.split('.');

    expect(guests.verify(scopeId, `${token}x`)).toBeNull();
    expect(guests.verify(scopeId, `${id}.${guestId}.${issuedAt}.подделка`)).toBeNull();
    expect(guests.verify(scopeId, undefined)).toBeNull();
    expect(guests.verify(scopeId, 'мусор')).toBeNull();
  });

  it('токен, подписанный другим секретом, не проходит проверку', () => {
    const scopeId = randomUUID();
    const { token } = guests.create(scopeId);

    expect(new GuestSessions(OTHER_SECRET, scope).verify(scopeId, token)).toBeNull();
  });

  it('токен любой другой JWT-подобной строки (header.payload.signature) не проходит — регрессия на общий секрет с JWT', () => {
    // Формат JWT: три сегмента через точку — раньше при lastIndexOf('.') такое
    // принималось за "guestId.подпись" и проходило проверку тем же секретом
    const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';

    expect(guests.verify(randomUUID(), jwtLike)).toBeNull();
  });

  it('просроченный токен (старше 30 дней) отклоняется — 6.2', () => {
    vi.useFakeTimers();
    const scopeId = randomUUID();
    const { token } = guests.create(scopeId);

    vi.advanceTimersByTime(TTL_MS + 1);
    expect(guests.verify(scopeId, token)).toBeNull();
  });

  it('токен в границах TTL остаётся действительным', () => {
    vi.useFakeTimers();
    const scopeId = randomUUID();
    const { guestId, token } = guests.create(scopeId);

    vi.advanceTimersByTime(TTL_MS - 1);
    expect(guests.verify(scopeId, token)).toBe(guestId);
  });

  it('issue переподключает того же гостя новым токеном', () => {
    const scopeId = randomUUID();
    const { guestId } = guests.create(scopeId);

    expect(guests.verify(scopeId, guests.issue(scopeId, guestId))).toBe(guestId);
  });

  describe('resume', () => {
    it('возвращает того же гостя по действующему токену', () => {
      const scopeId = randomUUID();
      const first = guests.create(scopeId);

      const resumed = guests.resume(scopeId, first.token);

      expect(resumed.guestId).toBe(first.guestId);
      expect(guests.verify(scopeId, resumed.token)).toBe(first.guestId);
    });

    it('заводит нового гостя, если токена нет или он не подходит', () => {
      const scopeId = randomUUID();
      const foreign = guests.create(randomUUID());

      expect(guests.resume(scopeId, undefined).guestId).not.toBe(foreign.guestId);
      expect(guests.resume(scopeId, foreign.token).guestId).not.toBe(foreign.guestId);
    });

    it('продлевает срок жизни от последнего подключения, а не от первого', () => {
      vi.useFakeTimers();
      const scopeId = randomUUID();
      const first = guests.create(scopeId);

      // Гость заходит на 29-й день — срок должен пойти заново
      vi.advanceTimersByTime(TTL_MS - 1);
      const resumed = guests.resume(scopeId, first.token);
      vi.advanceTimersByTime(TTL_MS - 1);

      expect(guests.verify(scopeId, resumed.token)).toBe(first.guestId);
      expect(guests.verify(scopeId, first.token)).toBeNull();
    });
  });
});

/**
 * Ради этого свойства доменная метка вообще существует, но до объединения
 * модулей его нельзя было проверить: копии не знали друг о друге. Секрет у
 * комнат и досок общий (`config.auth.guestSecret`), поэтому без метки токен
 * гостя комнаты подошёл бы к доске с тем же идентификатором.
 */
describe('разделение скоупов', () => {
  it('токен гостя комнаты не проходит проверку как токен гостя доски', () => {
    const sharedId = randomUUID();
    const rooms = new GuestSessions(SECRET, 'guest');
    const boards = new GuestSessions(SECRET, 'boardGuest');

    const { token } = rooms.create(sharedId);

    expect(rooms.verify(sharedId, token)).not.toBeNull();
    expect(boards.verify(sharedId, token)).toBeNull();
  });
});

/**
 * Токены уже выданы и лежат у пользователей до 30 дней. Если формат или
 * подписываемое сообщение изменятся, все гости молча станут новыми — потеряют
 * своё место за столом. Эталоны сняты с реализации до объединения модулей
 * (`GuestSessions` / `BoardGuestSessions`) и менять их вместе с кодом нельзя:
 * красный тест здесь означает не «поправь эталон», а «это ломающее изменение».
 */
describe('совместимость формата токена', () => {
  const SCOPE_ID = '11111111-2222-3333-4444-555555555555';
  const GUEST_ID = '99999999-8888-7777-6666-555555555555';
  const ISSUED_AT = 1700000000000;

  const GOLDEN: Record<GuestScope, string> = {
    guest: `${SCOPE_ID}.${GUEST_ID}.${ISSUED_AT}.WTAfB3KBkNJn-xQJanW84jy_ULpmrv-4Fc5_fZ1X7rc`,
    boardGuest: `${SCOPE_ID}.${GUEST_ID}.${ISSUED_AT}.iRRQ6COL_63-Qh-R17d5Wf4vNz-3uDOd3D298Z0ddP4`,
  };

  it.each(SCOPES)('токен, выданный прежней реализацией, принимается (scope: %s)', (scope) => {
    vi.useFakeTimers();
    vi.setSystemTime(ISSUED_AT + 1000);

    expect(new GuestSessions(SECRET, scope).verify(SCOPE_ID, GOLDEN[scope])).toBe(GUEST_ID);
  });

  it.each(SCOPES)('issue воспроизводит ту же подпись (scope: %s)', (scope) => {
    vi.useFakeTimers();
    vi.setSystemTime(ISSUED_AT);

    expect(new GuestSessions(SECRET, scope).issue(SCOPE_ID, GUEST_ID)).toBe(GOLDEN[scope]);
  });
});
