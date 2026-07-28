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
  await vi.waitFor(() => expect(wrapper.text()).toContain('EstiMate'));
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

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Оценка спринта, которая проходит быстро и без спора'),
    );
    expect(wrapper.text()).toContain('Играйте картами');
  });

  it('гостю предлагает войти, а не выйти', async () => {
    const wrapper = await mountApp('/');

    expect(wrapper.text()).toContain('Войти');
    expect(wrapper.text()).not.toContain('Выйти');
  });

  it('переключатель темы в шапке гостя переключает светлую/тёмную', async () => {
    await mountApp('/');
    document.documentElement.classList.remove('dark');

    const toggle = document.body.querySelector('button[role="switch"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-checked')).toBe('false');

    (toggle as HTMLElement).click();
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    expect(toggle!.getAttribute('aria-checked')).toBe('true');

    (toggle as HTMLElement).click();
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Иван'));

    // Меню пользователя телепортируется в document.body, поэтому и триггер,
    // и пункт «Выйти» ищем через реальный DOM, а не дерево wrapper
    const menuTrigger = document.body.querySelector('button[aria-label="Меню пользователя"]');
    (menuTrigger as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Выйти'));

    const logoutItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Выйти',
    );
    (logoutItem as HTMLElement).click();

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'));
    expect(wrapper.text()).toContain('Войти');
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Иван'));

    const menuTrigger = document.body.querySelector('button[aria-label="Меню пользователя"]');
    (menuTrigger as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Выйти'));

    const logoutItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Выйти',
    );
    (logoutItem as HTMLElement).click();

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'));
    expect(wrapper.text()).toContain('Войти');
  });
});

describe('страница профиля', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('показывает имя, почту и провайдера входа', async () => {
    const fetchImpl = vi.fn((path: string) => {
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
      return Promise.resolve(jsonResponse(404, { error: 'not_found', message: 'нет' }));
    });
    vi.stubGlobal('fetch', fetchImpl);

    const pinia = createPinia();
    const router = createAppRouter(createMemoryHistory());
    const wrapper = mount(App, {
      global: { plugins: [pinia, router, createAppI18n('ru'), ui] },
      attachTo: document.body,
    });
    await router.push('/profile');
    await router.isReady();

    await vi.waitFor(() => expect(wrapper.text()).toContain('ivan@example.com'));
    expect(wrapper.text()).toContain('Google');
  });

  it('позволяет отредактировать имя и должность', async () => {
    let currentUser = {
      id: 'u1',
      provider: 'google',
      email: 'ivan@example.com',
      name: 'Иван',
      jobTitle: null as string | null,
      avatarUrl: null,
    };
    const fetchImpl = vi.fn((path: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/me' && method === 'PATCH') {
        const body = JSON.parse(init?.body as string) as { name: string; jobTitle: string };
        currentUser = { ...currentUser, name: body.name, jobTitle: body.jobTitle || null };
        return Promise.resolve(jsonResponse(200, { user: currentUser }));
      }
      if (path === '/api/me') {
        return Promise.resolve(jsonResponse(200, { user: currentUser }));
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
    await router.push('/profile');
    await router.isReady();
    await vi.waitFor(() => expect(wrapper.text()).toContain('ivan@example.com'));

    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('Новое Имя');
    await inputs[1]!.setValue('Фронтенд-разработчик');
    await wrapper.find('form').trigger('submit');

    await vi.waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/me',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Профиль обновлён'));
  });

  it('не даёт сохранить пустое имя', async () => {
    const fetchImpl = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>((path) => {
      if (path === '/api/me') {
        return Promise.resolve(
          jsonResponse(200, {
            user: {
              id: 'u1',
              provider: 'google',
              email: 'ivan@example.com',
              name: 'Иван',
              jobTitle: null,
              avatarUrl: null,
            },
          }),
        );
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
    await router.push('/profile');
    await router.isReady();
    await vi.waitFor(() => expect(wrapper.text()).toContain('ivan@example.com'));

    const nameInput = wrapper.findAll('input')[0]!;
    await nameInput.setValue('   ');
    await wrapper.find('form').trigger('submit');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Введите имя'));
    expect(fetchImpl.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(false);
  });
});

describe('меню пользователя: тема и язык', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('пункт «Тёмная тема» в меню применяет тёмную тему и не закрывает меню', async () => {
    const fetchImpl = vi.fn((path: string) => {
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Иван'));

    const menuTrigger = document.body.querySelector('button[aria-label="Меню пользователя"]');
    (menuTrigger as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Тёмная тема'));

    const darkOption = Array.from(document.body.querySelectorAll('[role="menuitemcheckbox"]')).find(
      (el) => el.textContent?.trim() === 'Тёмная тема',
    );
    (darkOption as HTMLElement).click();

    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    // Меню осталось открытым — пункт всё ещё виден в DOM
    expect(document.body.textContent).toContain('Тёмная тема');
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
