import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from '../src/lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('клиент API', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('возвращает разобранное тело ответа', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }));

    await expect(api.get('/api/me')).resolves.toEqual({ user: { id: 'u1' } });
  });

  it('передаёт код и сообщение ошибки сервера', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: 'conflict', message: 'Ссылки уже изменили' }),
    );

    const err = await api.get('/api/rooms').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'conflict', message: 'Ссылки уже изменили' });
  });

  it('после 401 продлевает сессию и повторяет запрос один раз', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { error: 'unauthorized', message: 'Требуется вход' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }))
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }));

    await expect(api.get('/api/me')).resolves.toEqual({ user: { id: 'u1' } });

    const paths = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(paths).toEqual(['/api/me', '/api/auth/refresh', '/api/me']);
  });

  it('не пытается продлевать сессию, если 401 вернуло само продление', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: 'unauthorized', message: 'Кука недействительна' }),
    );

    await expect(api.post('/api/auth/refresh')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('сдаётся, если продлить сессию не удалось', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized', message: 'Нет сессии' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized', message: 'Нет сессии' }));

    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('на два одновременных 401 продлевает сессию одним запросом', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/api/auth/refresh') return Promise.resolve(jsonResponse(200, {}));
      const first = fetchMock.mock.calls.filter((call) => call[0] === path).length === 1;
      return Promise.resolve(
        first
          ? jsonResponse(401, { error: 'unauthorized', message: 'Требуется вход' })
          : jsonResponse(200, { ok: true }),
      );
    });

    await Promise.all([api.get('/api/me'), api.get('/api/teams')]);

    const refreshes = fetchMock.mock.calls.filter((call) => call[0] === '/api/auth/refresh');
    expect(refreshes).toHaveLength(1);
  });

  it('не пытается разобрать пустое тело', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.post('/api/auth/logout')).resolves.toBeUndefined();
  });
});
