import { beforeEach, describe, expect, it } from 'vitest';

import { BoardGuestSessions } from '../src/boards/board-guest-sessions';

const SECRET = 'тестовый-секрет-должен-быть-длиннее-тридцати-двух-символов';

describe('BoardGuestSessions', () => {
  let sessions: BoardGuestSessions;

  beforeEach(() => {
    sessions = new BoardGuestSessions(SECRET);
  });

  it('create выписывает токен для конкретной доски', () => {
    const { guestId, token } = sessions.create('board-1');

    expect(guestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(token).toMatch(/^board-1\./);
    expect(token.split('.')[1]).toBe(guestId);
  });

  it('verify возвращает guestId для валидного токена', () => {
    const { guestId, token } = sessions.create('board-1');
    expect(sessions.verify('board-1', token)).toBe(guestId);
  });

  it('verify отклоняет токен другой доски', () => {
    const { token } = sessions.create('board-1');
    expect(sessions.verify('board-2', token)).toBeNull();
  });

  it('verify отклоняет поддельный токен', () => {
    const fake = 'board-1.abc.def.sig';
    expect(sessions.verify('board-1', fake)).toBeNull();
  });

  it('verify отклоняет undefined', () => {
    expect(sessions.verify('board-1', undefined)).toBeNull();
  });

  it('verify отклоняет токен с неверной подписью', () => {
    const { token } = sessions.create('board-1');
    // Меняем последнюю часть подписи
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.invalid`;
    expect(sessions.verify('board-1', tampered)).toBeNull();
  });

  it('token выпусканный с одного секрета не проходит verify с другим', () => {
    const { token } = sessions.create('board-1');
    const other = new BoardGuestSessions('другой-секрет-длиной-более-тридцати-двух-символов');
    expect(other.verify('board-1', token)).toBeNull();
  });

  it('verify с тем же guestId выпускает новый валидный токен (переподключение)', () => {
    const { guestId } = sessions.create('board-1');
    const token = sessions.issue('board-1', guestId);
    // Новый токен верифицируется и возвращает тот же guestId
    expect(sessions.verify('board-1', token)).toBe(guestId);
  });
});
