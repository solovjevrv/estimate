import type { AuthUser } from '@estimate/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '../src/stores/session';

const user: AuthUser = {
  id: 'u1',
  provider: 'google',
  email: 'user@example.com',
  name: 'Иван',
  jobTitle: null,
  avatarUrl: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('стор сессии', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('подтягивает профиль вошедшего пользователя', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user }));
    const session = useSessionStore();

    await session.ensureLoaded();

    expect(session.user).toEqual(user);
    expect(session.isAuthenticated).toBe(true);
  });

  it('считает гостем того, кому сервер ответил 401', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: 'unauthorized', message: 'Нет сессии' }),
    );
    const session = useSessionStore();

    await session.ensureLoaded();

    expect(session.user).toBeNull();
    expect(session.loaded).toBe(true);
  });

  it('переживает недоступность сети, оставляя пользователя гостем', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('сеть недоступна'));
    const session = useSessionStore();

    await session.ensureLoaded();

    expect(session.user).toBeNull();
    expect(session.loaded).toBe(true);
  });

  it('на несколько одновременных вызовов делает один запрос профиля', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user }));
    const session = useSessionStore();

    await Promise.all([session.ensureLoaded(), session.ensureLoaded(), session.ensureLoaded()]);
    // И после загрузки повторно не ходит
    await session.ensureLoaded();

    const profileCalls = fetchMock.mock.calls.filter((call) => call[0] === '/api/me');
    expect(profileCalls).toHaveLength(1);
  });

  it('забывает пользователя, даже если запрос выхода не дошёл', async () => {
    const session = useSessionStore();
    session.setUser(user);
    fetchMock.mockRejectedValue(new Error('сеть недоступна'));

    await expect(session.logout()).rejects.toThrow();

    expect(session.user).toBeNull();
  });

  it('обновляет имя и должность и сохраняет ответ сервера в сторе', async () => {
    const session = useSessionStore();
    session.setUser(user);
    const updated: AuthUser = { ...user, name: 'Новое Имя', jobTitle: 'Аналитик' };
    fetchMock.mockResolvedValue(jsonResponse(200, { user: updated }));

    const result = await session.updateProfile({ name: 'Новое Имя', jobTitle: 'Аналитик' });

    expect(result).toEqual(updated);
    expect(session.user).toEqual(updated);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Новое Имя', jobTitle: 'Аналитик' }),
      }),
    );
  });

  it('отказ сервера при обновлении профиля не подменяет уже загруженного пользователя', async () => {
    const session = useSessionStore();
    session.setUser(user);
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'bad_request', message: 'Имя пустое' }));

    await expect(session.updateProfile({ name: '', jobTitle: '' })).rejects.toThrow();

    expect(session.user).toEqual(user);
  });

  it('спрашивает у сервера включённые способы входа', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { providers: ['google', 'yandex'] }));
    const session = useSessionStore();

    await session.loadProviders();

    expect(session.providers).toEqual(['google', 'yandex']);
  });

  it('без ответа о провайдерах показывает пустой список, а не падает', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('сеть недоступна'));
    const session = useSessionStore();

    await session.loadProviders();

    expect(session.providers).toEqual([]);
  });
});
