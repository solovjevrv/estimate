import ui from '@nuxt/ui/vue-plugin';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';

import App from '../src/App.vue';
import { createAppI18n } from '../src/i18n';
import { createAppRouter } from '../src/router';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Собирает приложение целиком: роутер, сторы, переводы и компоненты Nuxt UI */
async function mountApp(path: string) {
  // Pinia ставится раньше роутера: гард обращается к стору сессии, и без
  // активной Pinia первый же переход упал бы — тот же порядок в main.ts
  const pinia = createPinia();
  const router = createAppRouter(createMemoryHistory());

  const wrapper = mount(App, {
    global: { plugins: [pinia, router, createAppI18n('ru'), ui] },
    attachTo: document.body,
  });

  await router.push(path);
  await router.isReady();

  // Страницы грузятся асинхронно, профиль и провайдеры — запросами
  await vi.waitFor(() => expect(wrapper.text()).toContain('Planning Poker'));
  return wrapper;
}

describe('каркас приложения', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) =>
        Promise.resolve(
          path === '/api/auth/providers'
            ? jsonResponse(200, { providers: ['google', 'yandex'] })
            : jsonResponse(401, { error: 'unauthorized', message: 'Нет сессии' }),
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('показывает шапку и главную страницу', async () => {
    const wrapper = await mountApp('/');

    await vi.waitFor(() => expect(wrapper.text()).toContain('1, 2, 3, 5, 8, 13, 21'));
    expect(wrapper.text()).toContain('Оценка задач командой');
  });

  it('гостю предлагает войти, а не выйти', async () => {
    const wrapper = await mountApp('/');

    expect(wrapper.text()).toContain('Войти');
    expect(wrapper.text()).not.toContain('Выйти');
  });

  it('на странице входа показывает включённые способы входа', async () => {
    const wrapper = await mountApp('/login');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Войти через Google'));
    expect(wrapper.text()).toContain('Войти через Яндекс');
    // Вход — переход браузера на сервер, поэтому именно ссылка
    expect(wrapper.find('a[href="/api/auth/google"]').exists()).toBe(true);
  });

  it('после неудачного входа объясняет, что произошло', async () => {
    const wrapper = await mountApp('/login?error=oauth');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Войти не удалось'));
  });

  it('на несуществующем адресе показывает страницу «не найдено»', async () => {
    const wrapper = await mountApp('/такого-нет');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Страница не найдена'));
  });
});

describe('выход из аккаунта', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('выход уводит с приватной страницы на главную', async () => {
    const fetchImpl = vi.fn((path: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/me') {
        return Promise.resolve(
          jsonResponse(200, {
            user: {
              id: 'u1',
              provider: 'google',
              email: 'ivan@example.com',
              name: 'Иван',
              avatarUrl: null,
            },
          }),
        );
      }
      if (path === '/api/auth/providers') {
        return Promise.resolve(jsonResponse(200, { providers: ['google', 'yandex'] }));
      }
      if (path === '/api/teams') return Promise.resolve(jsonResponse(200, { teams: [] }));
      if (method === 'POST' && path === '/api/auth/logout') {
        return Promise.resolve(jsonResponse(200, {}));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not_found', message: 'нет' }));
    });
    vi.stubGlobal('fetch', fetchImpl);

    const pinia = createPinia();
    const router = createAppRouter(createMemoryHistory());
    const wrapper = mount(App, {
      global: { plugins: [pinia, router, createAppI18n('ru'), ui] },
      attachTo: document.body,
    });
    await router.push('/teams');
    await router.isReady();
    await vi.waitFor(() => expect(wrapper.text()).toContain('Выйти'));

    const logoutButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Выйти');
    await logoutButton!.trigger('click');

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'));
    expect(wrapper.text()).toContain('Войти');
    expect(wrapper.text()).not.toContain('Выйти');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('уводит на главную, даже если запрос выхода не дошёл до сервера', async () => {
    const fetchImpl = vi.fn((path: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/me') {
        return Promise.resolve(
          jsonResponse(200, {
            user: {
              id: 'u1',
              provider: 'google',
              email: 'ivan@example.com',
              name: 'Иван',
              avatarUrl: null,
            },
          }),
        );
      }
      if (path === '/api/auth/providers') {
        return Promise.resolve(jsonResponse(200, { providers: ['google', 'yandex'] }));
      }
      if (path === '/api/teams') return Promise.resolve(jsonResponse(200, { teams: [] }));
      if (method === 'POST' && path === '/api/auth/logout') {
        // Сеть недоступна: session.logout() всё равно чистит пользователя на клиенте
        return Promise.reject(new Error('сеть недоступна'));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not_found', message: 'нет' }));
    });
    vi.stubGlobal('fetch', fetchImpl);

    const pinia = createPinia();
    const router = createAppRouter(createMemoryHistory());
    const wrapper = mount(App, {
      global: { plugins: [pinia, router, createAppI18n('ru'), ui] },
      attachTo: document.body,
    });
    await router.push('/teams');
    await router.isReady();
    await vi.waitFor(() => expect(wrapper.text()).toContain('Выйти'));

    const logoutButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Выйти');
    await logoutButton!.trigger('click');

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'));
    expect(wrapper.text()).toContain('Войти');
  });
});

describe('создание личной комнаты с главной', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function dialog(): HTMLElement | null {
    return document.body.querySelector('[role="dialog"]');
  }

  it('гостю не показывает кнопку создания комнаты', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) =>
        Promise.resolve(
          path === '/api/auth/providers'
            ? jsonResponse(200, { providers: ['google', 'yandex'] })
            : jsonResponse(401, { error: 'unauthorized', message: 'нет' }),
        ),
      ),
    );
    const wrapper = await mountApp('/');

    expect(wrapper.text()).not.toContain('Создать комнату');
  });

  it('авторизованный создаёт личную комнату и переходит в неё', async () => {
    const created = {
      id: 'r7',
      teamId: null,
      creatorId: 'u1',
      name: 'Моя комната',
      status: 'active',
      revision: 0,
      createdAt: '2026-07-25T00:00:00.000Z',
    };
    const fetchImpl = vi.fn((path: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/me') {
        return Promise.resolve(
          jsonResponse(200, {
            user: {
              id: 'u1',
              provider: 'google',
              email: 'ivan@example.com',
              name: 'Иван',
              avatarUrl: null,
            },
          }),
        );
      }
      if (path === '/api/auth/providers') {
        return Promise.resolve(jsonResponse(200, { providers: ['google', 'yandex'] }));
      }
      if (path === '/api/rooms/r7') return Promise.resolve(jsonResponse(200, { room: created }));
      if (method === 'POST' && path === '/api/rooms') {
        return Promise.resolve(jsonResponse(201, { room: created }));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not_found', message: 'нет' }));
    });
    vi.stubGlobal('fetch', fetchImpl);

    const pinia = createPinia();
    const router = createAppRouter(createMemoryHistory());
    const wrapper = mount(App, {
      global: { plugins: [pinia, router, createAppI18n('ru'), ui] },
      attachTo: document.body,
    });
    await router.push('/');
    await router.isReady();
    await vi.waitFor(() => expect(wrapper.text()).toContain('Создать комнату'));

    const openButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Создать комнату');
    await openButton!.trigger('click');
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Новая комната'));

    const input = dialog()!.querySelector('input') as HTMLInputElement;
    input.value = 'Моя комната';
    input.dispatchEvent(new Event('input'));
    const submitButton = Array.from(dialog()?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === 'Создать комнату',
    );
    submitButton!.click();

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rooms/r7'));
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/rooms',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
