import type { Room } from '@poker/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api';
import { useTeamRoomsStore } from '../src/stores/team-rooms';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function room(over: Partial<Room>): Room {
  return {
    id: 'r1',
    teamId: 't1',
    creatorId: 'u1',
    name: 'Комната',
    status: 'active',
    revision: 0,
    createdAt: '2026-07-24T00:00:00.000Z',
    ...over,
  };
}

describe('стор комнат команды', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('загружает комнаты и делит их на активные и завершённые', async () => {
    const rooms = [
      room({ id: 'r1', status: 'active', createdAt: '2026-07-20T00:00:00.000Z' }),
      room({ id: 'r2', status: 'closed', createdAt: '2026-07-22T00:00:00.000Z' }),
      room({ id: 'r3', status: 'active', createdAt: '2026-07-24T00:00:00.000Z' }),
    ];
    fetchMock.mockResolvedValue(json(200, { rooms }));
    const store = useTeamRoomsStore();

    await store.load('t1');

    // Активные отсортированы по дате: свежая r3 впереди r1
    expect(store.active.map((r) => r.id)).toEqual(['r3', 'r1']);
    expect(store.closed.map((r) => r.id)).toEqual(['r2']);
  });

  it('reset очищает список', async () => {
    fetchMock.mockResolvedValue(json(200, { rooms: [room({})] }));
    const store = useTeamRoomsStore();
    await store.load('t1');
    expect(store.list).toHaveLength(1);

    store.reset();

    expect(store.list).toEqual([]);
  });

  it('пробрасывает ApiError при отказе сервера', async () => {
    fetchMock.mockResolvedValue(json(404, { error: 'not_found', message: 'нет' }));
    const store = useTeamRoomsStore();

    await expect(store.load('t1')).rejects.toBeInstanceOf(ApiError);
  });
});
