import ui from '@nuxt/ui/vue-plugin';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';

import App from '../src/App.vue';
import { createAppI18n } from '../src/i18n';
import { createAppRouter } from '../src/router';

const REDIRECT_KEY = 'poker:post-login-redirect';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function mountLogin(path: string) {
  const pinia = createPinia();
  const router = createAppRouter(createMemoryHistory());

  const wrapper = mount(App, {
    global: { plugins: [pinia, router, createAppI18n('ru'), ui] },
    attachTo: document.body,
  });

  await router.push(path);
  await router.isReady();
  await vi.waitFor(() => expect(wrapper.text()).toContain('Войти через Google'));
  return { wrapper, router };
}

describe('страница входа', () => {
  beforeEach(() => {
    sessionStorage.clear();
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
    sessionStorage.clear();
  });

  it('перед уходом к провайдеру запоминает, куда пользователь шёл', async () => {
    const { wrapper } = await mountLogin('/login?redirect=/teams');

    await wrapper.find('a[href="/api/auth/google"]').trigger('click');

    expect(sessionStorage.getItem(REDIRECT_KEY)).toBe('/teams');
  });

  it('показывает прогресс на нажатой кнопке', async () => {
    const { wrapper } = await mountLogin('/login');

    await wrapper.find('a[href="/api/auth/google"]').trigger('click');

    expect(wrapper.text()).toContain('Перенаправляем');
  });

  it('вход через провайдера — внешняя ссылка, а не переход внутри приложения', async () => {
    // Кнопка ведёт на /api/auth/… — это адрес бэкенда, а не роут приложения.
    // Без пометки «внешняя» Nuxt UI перехватил бы клик как переход роутера и
    // увёл бы на страницу «не найдено» вместо полной загрузки и старта OAuth.
    const { wrapper, router } = await mountLogin('/login');

    await wrapper.find('a[href="/api/auth/yandex"]').trigger('click');

    // Роутер остался на входе: клик не был перехвачен как внутренний переход,
    // значит браузер выполнит настоящую загрузку /api/auth/yandex и стартует OAuth
    expect(router.currentRoute.value.name).toBe('login');
  });

  it('не запоминает внешний адрес возврата', async () => {
    const { wrapper } = await mountLogin('/login?redirect=//evil.com');

    await wrapper.find('a[href="/api/auth/google"]').trigger('click');

    expect(sessionStorage.getItem(REDIRECT_KEY)).toBeNull();
  });

  it('после неудачного входа показывает сообщение и чистит адрес', async () => {
    const { wrapper, router } = await mountLogin('/login?error=oauth');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Войти не удалось'));
    // Сообщение осталось, но ?error из адреса убрали — перезагрузка его не повторит
    expect(router.currentRoute.value.query.error).toBeUndefined();
  });
});
