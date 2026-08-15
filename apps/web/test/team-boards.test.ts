import type { BoardSummary } from '@poker/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api';
import { useTeamBoardsStore } from '../src/stores/team-boards';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function board(over: Partial<BoardSummary>): BoardSummary {
  return {
    id: 'b1',
    teamId: 't1',
    ownerId: 'u1',
    title: 'Доска',
    status: 'active',
    revision: 0,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    itemCount: 0,
    shareRole: null,
    ...over,
  };
}

describe('стор досок команды', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('загружает активные доски, отсортированные по свежести', async () => {
    const boards = [
      board({ id: 'b1', createdAt: '2026-08-01T00:00:00.000Z' }),
      board({ id: 'b2', createdAt: '2026-08-03T00:00:00.000Z' }),
    ];
    fetchMock.mockResolvedValue(json(200, { boards }));
    const store = useTeamBoardsStore();

    await store.load('t1');

    expect(store.active.map((b) => b.id)).toEqual(['b2', 'b1']);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/t1/boards');
  });

  it('загружает архивные доски отдельным запросом', async () => {
    const archived = [board({ id: 'b3', status: 'archived' })];
    fetchMock.mockResolvedValue(json(200, { boards: archived }));
    const store = useTeamBoardsStore();

    await store.loadArchived('t1');

    expect(store.archived.map((b) => b.id)).toEqual(['b3']);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/t1/boards?archived=true');
  });

  it('reset очищает оба списка', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { boards: [board({})] })));
    const store = useTeamBoardsStore();
    await store.load('t1');
    await store.loadArchived('t1');
    expect(store.list).toHaveLength(1);
    expect(store.archived).toHaveLength(1);

    store.reset();

    expect(store.list).toEqual([]);
    expect(store.archived).toEqual([]);
  });

  it('не возвращает архив предыдущей команды после reset', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const store = useTeamBoardsStore();

    const loading = store.loadArchived('t1');
    store.reset();
    resolveRequest?.(json(200, { boards: [board({ id: 'old', teamId: 't1' })] }));
    await loading;

    expect(store.archived).toEqual([]);
  });

  it('пробрасывает ApiError при отказе сервера', async () => {
    fetchMock.mockResolvedValue(json(404, { error: 'not_found', message: 'нет' }));
    const store = useTeamBoardsStore();

    await expect(store.load('t1')).rejects.toBeInstanceOf(ApiError);
  });
});
