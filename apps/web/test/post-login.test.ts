import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import { routes } from '../src/router';
import { applyPostLoginRedirect } from '../src/router/post-login';

const REDIRECT_KEY = 'poker:post-login-redirect';

/** Роутер без гарда — здесь проверяем только разбор отложенной цели */
async function readyRouter(): Promise<Router> {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/');
  return router;
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
