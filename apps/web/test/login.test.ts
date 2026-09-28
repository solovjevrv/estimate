import ui from '@nuxt/ui/vue-plugin';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';

import App from '../src/App.vue';
import { createAppI18n } from '../src/i18n';
import { createAppRouter } from '../src/router';

const REDIRECT_KEY = 'estimate:post-login-redirect';

// Окно входа телепортируется в document.body — без размонтирования оно копилось бы
// между тестами
enableAutoUnmount(afterEach);

function link(href: string): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(`a[href="${href}"]`);
  if (!el) throw new Error(`нет ссылки ${href}`);
  return el;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function mountLogin(path: string, expectOpen = true) {
  const pinia = createPinia();
  const router = createAppRouter(createMemoryHistory());

  mount(App, {
    global: { plugins: [pinia, router, createAppI18n('ru'), ui] },
    attachTo: document.body,
  });

  await router.push(path);
  await router.isReady();
  if (expectOpen) {
    await vi.waitFor(() => expect(document.body.textContent).toContain('Войти через Google'));
  }
  return { router };
}

describe('окно входа', () => {
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
    await mountLogin('/login?redirect=/teams');

    link('/api/auth/google').click();

    expect(sessionStorage.getItem(REDIRECT_KEY)).toBe('/teams');
  });

  it('показывает прогресс на нажатой кнопке', async () => {
    await mountLogin('/login');

    link('/api/auth/google').click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('Перенаправляем'));
  });

  it('вход через провайдера — внешняя ссылка, а не переход внутри приложения', async () => {
    // Кнопка ведёт на /api/auth/… — это адрес бэкенда, а не роут приложения.
    // Без пометки «внешняя» Nuxt UI перехватил бы клик как переход роутера и
    // увёл бы на страницу «не найдено» вместо полной загрузки и старта OAuth.
    const { router } = await mountLogin('/login');

    link('/api/auth/yandex').click();

    // Роутер остался на входе: клик не был перехвачен как внутренний переход,
    // значит браузер выполнит настоящую загрузку /api/auth/yandex и стартует OAuth
    expect(router.currentRoute.value.name).toBe('login');
  });

  it('не запоминает внешний адрес возврата', async () => {
    await mountLogin('/login?redirect=//evil.com');

    link('/api/auth/google').click();

    expect(sessionStorage.getItem(REDIRECT_KEY)).toBeNull();
  });

  it('после неудачного входа показывает сообщение и чистит адрес', async () => {
    const { router } = await mountLogin('/login?error=oauth');

    await vi.waitFor(() => expect(document.body.textContent).toContain('Войти не удалось'));
    // Сообщение осталось, но ?error из адреса убрали — перезагрузка его не повторит
    expect(router.currentRoute.value.query.error).toBeUndefined();
  });

  it('кнопка «Войти» в шапке открывает окно на месте и запоминает текущую страницу', async () => {
    const { router } = await mountLogin('/invite/abc', false);

    const loginButton = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Войти',
    );
    loginButton!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Войти через Google'));
    // Страница под окном осталась прежней — без перехода на /login
    expect(router.currentRoute.value.path).toBe('/invite/abc');

    link('/api/auth/google').click();
    expect(sessionStorage.getItem(REDIRECT_KEY)).toBe('/invite/abc');
  });

  it('закрытие окна на /login уводит на главную', async () => {
    const { router } = await mountLogin('/login?redirect=/teams');

    document.body.querySelector<HTMLElement>('[role="dialog"] [data-slot="close"]')!.click();

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'));
  });
});
