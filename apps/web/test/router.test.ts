import { createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '../src/router';
import { useSessionStore } from '../src/stores/session';

const user = {
  id: 'u1',
  provider: 'google' as const,
  email: 'user@example.com',
  name: 'Иван',
  avatarUrl: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Профиль отвечает так, как будто пользователь вошёл или не вошёл */
function serveProfile(fetchMock: ReturnType<typeof vi.fn>, authenticated: boolean): void {
  fetchMock.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/api/me' && authenticated
        ? jsonResponse(200, { user })
        : jsonResponse(401, { error: 'unauthorized', message: 'Нет сессии' }),
    ),
  );
}

describe('гард роутера', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('уводит гостя со страницы команд на вход и запоминает, куда он шёл', async () => {
    serveProfile(fetchMock, false);
    const router = createAppRouter(createMemoryHistory());

    await router.push('/teams');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/teams');
  });

  it('пускает вошедшего пользователя на страницу команд', async () => {
    serveProfile(fetchMock, true);
    const router = createAppRouter(createMemoryHistory());

    await router.push('/teams');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('teams');
  });

  it('не показывает страницу входа тому, кто уже вошёл', async () => {
    serveProfile(fetchMock, true);
    const router = createAppRouter(createMemoryHistory());

    await router.push('/login');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('home');
  });

  it('пускает гостя на страницу приглашения по прямой ссылке', async () => {
    serveProfile(fetchMock, false);
    const router = createAppRouter(createMemoryHistory());

    await router.push('/invite/abcdef');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('invite');
    expect(router.currentRoute.value.params.code).toBe('abcdef');
  });

  it('уводит гостя со страницы команды на вход и запоминает адрес', async () => {
    serveProfile(fetchMock, false);
    const router = createAppRouter(createMemoryHistory());

    await router.push('/teams/t1');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/teams/t1');
  });

  it('пускает гостя в комнату по прямой ссылке', async () => {
    serveProfile(fetchMock, false);
    const router = createAppRouter(createMemoryHistory());

    await router.push('/rooms/abc');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('room');
    expect(router.currentRoute.value.params.id).toBe('abc');
  });

  it('ждёт ответ о профиле, а не отправляет на вход раньше времени', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => {
      await held;
      return jsonResponse(200, { user });
    });

    const router = createAppRouter(createMemoryHistory());
    const navigation = router.push('/teams');

    // Пока профиль не пришёл, переход не завершён
    expect(useSessionStore().loaded).toBe(false);
    release();
    await navigation;

    expect(router.currentRoute.value.name).toBe('teams');
  });

  it('на несуществующем адресе показывает страницу «не найдено»', async () => {
    serveProfile(fetchMock, false);
    const router = createAppRouter(createMemoryHistory());

    await router.push('/чего-то-нет');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('not-found');
  });
});
