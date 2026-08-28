import type { Room } from '@estimate/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  archiveRoom,
  createRoom,
  deleteRoom,
  getMyRoomStats,
  getRoom,
  getRoundHistory,
  listMyRooms,
  renameRoom,
} from '../src/features/rooms/api/rooms-api';

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
  jiraUrl: null,
  confluenceUrl: null,
  linksVersion: 1,
};

describe('API создания комнат', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('создаёт личную комнату без teamId', async () => {
    fetchMock.mockResolvedValue(json(201, { room }));
    const created = await createRoom('Комната');
    expect(created).toEqual(room);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Комната', teamId: undefined });
  });

  it('создаёт комнату от лица команды с teamId', async () => {
    const teamRoom: Room = { ...room, teamId: 't1' };
    fetchMock.mockResolvedValue(json(201, { room: teamRoom }));
    await createRoom('Комната', 't1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ name: 'Комната', teamId: 't1' });
  });

  it('пробрасывает ApiError при отказе сервера', async () => {
    fetchMock.mockResolvedValue(json(403, { error: 'forbidden', message: 'нет прав' }));
    await expect(createRoom('Комната', 't1')).rejects.toMatchObject({ status: 403 });
  });

  it('список своих комнат запрашивает archived только когда он запрошен', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { rooms: [room] })));
    const mine = await listMyRooms();
    expect(mine).toEqual([room]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/rooms?archived=false');
    await listMyRooms(true);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/rooms?archived=true');
  });

  it('getRoom возвращает комнату по id (id кодируется)', async () => {
    fetchMock.mockResolvedValue(json(200, { room }));
    const result = await getRoom('a/b');
    expect(result).toEqual(room);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/rooms/a%2Fb');
  });

  it('getRoundHistory возвращает раунды (id кодируется)', async () => {
    const rounds = [{ round: { id: 'rd1', seq: 1, average: 3 }, result: { votes: [] } }];
    fetchMock.mockResolvedValue(json(200, { rounds }));
    const result = await getRoundHistory('a/b');
    expect(result).toEqual(rounds);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/rooms/a%2Fb/rounds');
  });

  it('getMyRoomStats возвращает статистику', async () => {
    const stats = { roundsPlayed: 1, tasksEstimated: 2, avgRoundDurationSec: 30 };
    fetchMock.mockResolvedValue(json(200, { stats }));
    const result = await getMyRoomStats();
    expect(result).toEqual(stats);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/rooms/stats');
  });

  it('переименовывает комнату (id кодируется)', async () => {
    const renamed = { ...room, name: 'Новое название' };
    fetchMock.mockResolvedValue(json(200, { room: renamed }));
    const result = await renameRoom('a/b', 'Новое название');
    expect(result.name).toBe('Новое название');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rooms/a%2Fb');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Новое название' });
  });

  it('архивирует комнату (id кодируется)', async () => {
    const archived = { ...room, archivedAt: '2026-07-25T12:00:00.000Z' };
    fetchMock.mockResolvedValue(json(200, { room: archived }));
    const result = await archiveRoom('a/b');
    expect(result.archivedAt).toBe('2026-07-25T12:00:00.000Z');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rooms/a%2Fb/archive');
    expect(init.method).toBe('POST');
  });

  it('удаляет комнату навсегда (id кодируется)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteRoom('a/b');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rooms/a%2Fb');
    expect(init.method).toBe('DELETE');
  });
});
