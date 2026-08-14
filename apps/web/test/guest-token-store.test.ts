import { afterEach, describe, expect, it, vi } from 'vitest';

import { GuestTokenStore } from '../src/lib/realtime';

const rooms = new GuestTokenStore('poker:guest:');
const boards = new GuestTokenStore('poker:board-guest:');

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('GuestTokenStore', () => {
  it('возвращает сохранённый токен той же сущности', () => {
    rooms.write('room-1', 'token-1');

    expect(rooms.read('room-1')).toBe('token-1');
  });

  it('о незнакомой сущности не знает ничего', () => {
    expect(rooms.read('room-нет-такой')).toBeUndefined();
  });

  it('хранит сущности раздельно: токен одной комнаты в другой не подойдёт', () => {
    rooms.write('room-1', 'token-1');
    rooms.write('room-2', 'token-2');

    expect(rooms.read('room-1')).toBe('token-1');
    expect(rooms.read('room-2')).toBe('token-2');
  });

  it('комнаты и доски не перетирают записи друг друга при совпадении идентификаторов', () => {
    const sharedId = 'одинаковый-id';
    rooms.write(sharedId, 'токен-комнаты');
    boards.write(sharedId, 'токен-доски');

    expect(rooms.read(sharedId)).toBe('токен-комнаты');
    expect(boards.read(sharedId)).toBe('токен-доски');
  });

  it('null не пишет: сервер не выдал токен — значит вошёл авторизованный, затирать нечем', () => {
    rooms.write('room-1', 'token-1');

    rooms.write('room-1', null);

    expect(rooms.read('room-1')).toBe('token-1');
  });

  it('переживает недоступное хранилище: приватный режим не должен ронять вход', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('доступ к хранилищу запрещён');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('доступ к хранилищу запрещён');
    });

    expect(() => rooms.write('room-1', 'token-1')).not.toThrow();
    expect(rooms.read('room-1')).toBeUndefined();
  });
});
