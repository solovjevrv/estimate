import type { Room } from '@poker/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api';
import { useRoomsStore } from '../src/stores/rooms';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const room: Room = {
  id: 'r1',
  teamId: null,
  creatorId: 'u1',
  name: 'Комната',
  status: 'active',
  revision: 0,
  createdAt: '2026-07-25T00:00:00.000Z',
  archivedAt: null,
};

describe('стор создания комнат', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('создаёт личную комнату без teamId', async () => {
    fetchMock.mockResolvedValue(json(201, { room }));
    const store = useRoomsStore();

    const created = await store.create('Комната');

    expect(created).toEqual(room);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Комната', teamId: undefined });
  });

  it('создаёт комнату от лица команды с teamId', async () => {
    const teamRoom: Room = { ...room, teamId: 't1' };
    fetchMock.mockResolvedValue(json(201, { room: teamRoom }));
    const store = useRoomsStore();

    await store.create('Комната', 't1');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ name: 'Комната', teamId: 't1' });
  });

  it('пробрасывает ApiError при отказе сервера', async () => {
    fetchMock.mockResolvedValue(json(403, { error: 'forbidden', message: 'нет прав' }));
    const store = useRoomsStore();

    await expect(store.create('Комната', 't1')).rejects.toBeInstanceOf(ApiError);
  });

  it('список своих комнат запрашивает archived только когда он запрошен', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { rooms: [room] })));
    const store = useRoomsStore();

    const mine = await store.listMine();
    expect(mine).toEqual([room]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/rooms?archived=false');

    await store.listMine(true);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/rooms?archived=true');
  });

  it('архивирует комнату', async () => {
    const archived = { ...room, archivedAt: '2026-07-25T12:00:00.000Z' };
    fetchMock.mockResolvedValue(json(200, { room: archived }));
    const store = useRoomsStore();

    const result = await store.archive('r1');

    expect(result.archivedAt).toBe('2026-07-25T12:00:00.000Z');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rooms/r1/archive');
    expect(init.method).toBe('POST');
  });

  it('удаляет комнату навсегда', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const store = useRoomsStore();

    await store.remove('r1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rooms/r1');
    expect(init.method).toBe('DELETE');
  });
});
