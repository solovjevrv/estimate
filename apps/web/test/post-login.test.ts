import type { AuthUser } from '@poker/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import { createAppRouter, routes } from '../src/router';
import { applyPostLoginRedirect } from '../src/router/post-login';
import { useSessionStore } from '../src/stores/session';

const REDIRECT_KEY = 'poker:post-login-redirect';

/** Роутер без гарда — здесь проверяем только разбор отложенной цели */
async function readyRouter(): Promise<Router> {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/');
  return router;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('возврат на исходную страницу после входа', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('уводит вошедшего пользователя на сохранённую цель', async () => {
    sessionStorage.setItem(REDIRECT_KEY, '/teams');
    const router = await readyRouter();

    await applyPostLoginRedirect(router, { isAuthenticated: true });

    expect(router.currentRoute.value.name).toBe('teams');
    // Цель забрали — повторный старт её не воскресит
    expect(sessionStorage.getItem(REDIRECT_KEY)).toBeNull();
  });

  it('не уводит и стирает цель, если вход не удался', async () => {
    sessionStorage.setItem(REDIRECT_KEY, '/teams');
    const router = await readyRouter();

    await applyPostLoginRedirect(router, { isAuthenticated: false });

    expect(router.currentRoute.value.name).toBe('home');
    expect(sessionStorage.getItem(REDIRECT_KEY)).toBeNull();
  });

  it('без сохранённой цели оставляет пользователя на месте', async () => {
    const router = await readyRouter();

    await applyPostLoginRedirect(router, { isAuthenticated: true });

    expect(router.currentRoute.value.name).toBe('home');
  });
});

describe('связка с настоящим гардом роутера', () => {
  const user: AuthUser = {
    id: 'u1',
    provider: 'google',
    email: 'user@example.com',
    name: 'Иван',
    jobTitle: null,
    avatarUrl: null,
  };

  beforeEach(() => {
    sessionStorage.clear();
    setActivePinia(createPinia());
    // Профиль отдаётся с задержкой: проверяем, что редирект ждёт ответ, а не
    // срабатывает раньше, чем гард узнал о входе.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/api/me') {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return jsonResponse(200, { user });
        }
        return jsonResponse(401, { error: 'unauthorized', message: 'Нет сессии' });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('после входа уводит на приватную цель через реальный гард', async () => {
    sessionStorage.setItem(REDIRECT_KEY, '/teams');
    // Сервер вернул на «/» — воспроизводим стартовый переход приложения
    const router = createAppRouter(createMemoryHistory());
    void router.push('/');

    await applyPostLoginRedirect(router, useSessionStore());

    // Цель требует авторизации: гард пропустил, потому что профиль уже загружен
    expect(router.currentRoute.value.name).toBe('teams');
  });
});
