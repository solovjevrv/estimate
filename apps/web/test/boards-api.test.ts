import type { Board } from '@poker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  archiveBoard,
  createBoard,
  deleteBoard,
  getBoard,
  listMyBoards,
  renameBoard,
  setBoardShare,
  unarchiveBoard,
  uploadBoardAsset,
} from '../src/features/boards/api/boards-api';

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

describe('API создания досок', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('создаёт личную доску без teamId', async () => {
    fetchMock.mockResolvedValue(json(201, { board }));
    const created = await createBoard('Доска');
    expect(created).toEqual(board);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Доска', teamId: undefined });
  });

  it('создаёт доску от лица команды с teamId', async () => {
    const teamBoard: Board = { ...board, teamId: 't1' };
    fetchMock.mockResolvedValue(json(201, { board: teamBoard }));
    await createBoard('Доска', 't1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ title: 'Доска', teamId: 't1' });
  });

  it('пробрасывает ApiError при отказе сервера', async () => {
    fetchMock.mockResolvedValue(json(403, { error: 'forbidden', message: 'нет прав' }));
    await expect(createBoard('Доска', 't1')).rejects.toMatchObject({ status: 403 });
  });

  it('список своих досок запрашивает archived только когда он запрошен', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json(200, { boards: [{ ...board, itemCount: 0 }] })),
    );
    const mine = await listMyBoards();
    expect(mine).toEqual([{ ...board, itemCount: 0 }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/boards?archived=false');
    await listMyBoards(true);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/boards?archived=true');
  });

  it('получает снимок доски целиком (id кодируется)', async () => {
    fetchMock.mockResolvedValue(json(200, { board, items: [], edges: [] }));
    const snapshot = await getBoard('a/b');
    expect(snapshot).toEqual({ board, items: [], edges: [] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/boards/a%2Fb');
  });

  it('переименовывает доску (id кодируется)', async () => {
    const renamed = { ...board, title: 'Новое название' };
    fetchMock.mockResolvedValue(json(200, { board: renamed }));
    const result = await renameBoard('a/b', 'Новое название');
    expect(result.title).toBe('Новое название');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/boards/a%2Fb');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Новое название' });
  });

  it('архивирует доску (id кодируется)', async () => {
    const archived = { ...board, status: 'archived' as const };
    fetchMock.mockResolvedValue(json(200, { board: archived }));
    const result = await archiveBoard('a/b');
    expect(result.status).toBe('archived');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/boards/a%2Fb/archive');
    expect(init.method).toBe('POST');
  });

  it('восстанавливает доску из архива (id кодируется)', async () => {
    fetchMock.mockResolvedValue(json(200, { board }));
    await unarchiveBoard('a/b');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/boards/a%2Fb/unarchive');
    expect(init.method).toBe('POST');
  });

  it('удаляет доску навсегда (id кодируется)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteBoard('a/b');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/boards/a%2Fb');
    expect(init.method).toBe('DELETE');
  });

  it('set share отправляет PATCH /api/boards/:id/share с { role } (id кодируется)', async () => {
    fetchMock.mockResolvedValue(json(200, { board }));
    const result = await setBoardShare('a/b', 'view');
    expect(result).toEqual(board);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/boards/a%2Fb/share');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ role: 'view' });
  });

  describe('uploadBoardAsset', () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });

    it('валидный файл создаёт FormData с file и вызывает POST /assets (id кодируется)', async () => {
      fetchMock.mockResolvedValue(json(201, { url: '/a.png', width: 10, height: 20 }));
      const result = await uploadBoardAsset('a/b', file);
      expect(result).toEqual({ ok: true, asset: { url: '/a.png', width: 10, height: 20 } });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/boards/a%2Fb/assets');
      expect(init.method).toBe('POST');
      const fd = init.body as FormData;
      expect(fd).toBeInstanceOf(FormData);
      expect(fd.get('file')).toBeInstanceOf(File);
    });

    it('невалидный MIME не делает сеть', async () => {
      const bad = new File(['x'], 'x.txt', { type: 'text/plain' });
      const result = await uploadBoardAsset('b1', bad);
      expect(result).toEqual({ ok: false, reason: 'invalid_type' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('слишком большой файл не делает сеть', async () => {
      const big = new File([new Uint8Array(1024 * 1024 * 9)], 'x.png', { type: 'image/png' });
      const result = await uploadBoardAsset('b1', big);
      expect(result).toEqual({ ok: false, reason: 'too_large' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('413 маппится в too_large', async () => {
      fetchMock.mockResolvedValue(json(413, {}));
      const result = await uploadBoardAsset('b1', file);
      expect(result).toEqual({ ok: false, reason: 'too_large' });
    });

    it('400 маппится в invalid_type', async () => {
      fetchMock.mockResolvedValue(json(400, {}));
      const result = await uploadBoardAsset('b1', file);
      expect(result).toEqual({ ok: false, reason: 'invalid_type' });
    });

    it('403 маппится в forbidden', async () => {
      fetchMock.mockResolvedValue(json(403, {}));
      const result = await uploadBoardAsset('b1', file);
      expect(result).toEqual({ ok: false, reason: 'forbidden' });
    });

    it('500 маппится в failed', async () => {
      fetchMock.mockResolvedValue(json(500, {}));
      const result = await uploadBoardAsset('b1', file);
      expect(result).toEqual({ ok: false, reason: 'failed' });
    });

    it('сетевой отказ маппится в failed', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      const result = await uploadBoardAsset('b1', file);
      expect(result).toEqual({ ok: false, reason: 'failed' });
    });
  });
});
