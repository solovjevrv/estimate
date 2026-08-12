import type { Board } from '@poker/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api';
import { useBoardsStore } from '../src/stores/boards';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const board: Board = {
  id: 'b1',
  teamId: null,
  ownerId: 'u1',
  title: 'Доска',
  status: 'active',
  revision: 0,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  shareRole: null,
};

describe('стор создания досок', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('создаёт личную доску без teamId', async () => {
    fetchMock.mockResolvedValue(json(201, { board }));
    const store = useBoardsStore();

    const created = await store.create('Доска');

    expect(created).toEqual(board);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Доска', teamId: undefined });
  });

  it('создаёт доску от лица команды с teamId', async () => {
    const teamBoard: Board = { ...board, teamId: 't1' };
    fetchMock.mockResolvedValue(json(201, { board: teamBoard }));
    const store = useBoardsStore();

    await store.create('Доска', 't1');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ title: 'Доска', teamId: 't1' });
  });

  it('пробрасывает ApiError при отказе сервера', async () => {
    fetchMock.mockResolvedValue(json(403, { error: 'forbidden', message: 'нет прав' }));
    const store = useBoardsStore();

    await expect(store.create('Доска', 't1')).rejects.toBeInstanceOf(ApiError);
  });

  it('список своих досок запрашивает archived только когда он запрошен', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json(200, { boards: [{ ...board, itemCount: 0 }] })),
    );
    const store = useBoardsStore();

    const mine = await store.listMine();
    expect(mine).toEqual([{ ...board, itemCount: 0 }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/boards?archived=false');

    await store.listMine(true);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/boards?archived=true');
  });

  it('получает снимок доски целиком', async () => {
    fetchMock.mockResolvedValue(json(200, { board, items: [], edges: [] }));
    const store = useBoardsStore();

    const snapshot = await store.get('b1');

    expect(snapshot).toEqual({ board, items: [], edges: [] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/boards/b1');
  });

  it('переименовывает доску', async () => {
    const renamed = { ...board, title: 'Новое название' };
    fetchMock.mockResolvedValue(json(200, { board: renamed }));
    const store = useBoardsStore();

    const result = await store.rename('b1', 'Новое название');

    expect(result.title).toBe('Новое название');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/boards/b1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Новое название' });
  });

  it('архивирует доску', async () => {
    const archived = { ...board, status: 'archived' as const };
    fetchMock.mockResolvedValue(json(200, { board: archived }));
    const store = useBoardsStore();

    const result = await store.archive('b1');

    expect(result.status).toBe('archived');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/boards/b1/archive');
    expect(init.method).toBe('POST');
  });

  it('восстанавливает доску из архива', async () => {
    fetchMock.mockResolvedValue(json(200, { board }));
    const store = useBoardsStore();

    await store.unarchive('b1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/boards/b1/unarchive');
    expect(init.method).toBe('POST');
  });

  it('удаляет доску навсегда', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const store = useBoardsStore();

    await store.remove('b1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/boards/b1');
    expect(init.method).toBe('DELETE');
  });
});
