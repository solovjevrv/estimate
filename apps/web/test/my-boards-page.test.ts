import ui from '@nuxt/ui/vue-plugin';
import type { AuthUser, Board } from '@estimate/shared';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';

import App from '../src/App.vue';
import { createAppI18n } from '../src/i18n';
import { createAppRouter } from '../src/router';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const user: AuthUser = {
  id: 'u1',
  provider: 'google',
  email: 'ivan@example.com',
  name: 'Иван',
  jobTitle: null,
  avatarUrl: null,
};

const activeBoard: Board = {
  id: 'b1',
  teamId: null,
  ownerId: 'u1',
  title: 'Личная доска',
  status: 'active',
  revision: 0,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  shareRole: null,
};

type Handlers = Record<string, () => Response>;

function makeFetch(handlers: Handlers = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = handlers[`${method} ${url}`];
    if (handler) return Promise.resolve(handler());
    if (url === '/api/me') return Promise.resolve(json(200, { user }));
    if (url === '/api/auth/refresh') {
      return Promise.resolve(json(401, { error: 'unauthorized', message: 'нет' }));
    }
    if (url === '/api/auth/providers') {
      return Promise.resolve(json(200, { providers: ['google', 'yandex'] }));
    }
    return Promise.resolve(json(404, { error: 'not_found', message: 'нет' }));
  });
}

async function mountApp(fetchImpl: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchImpl);
  const pinia = createPinia();
  const router = createAppRouter(createMemoryHistory());
  const wrapper = mount(App, {
    global: { plugins: [pinia, router, createAppI18n('ru'), ui] },
    attachTo: document.body,
  });
  await router.push('/boards');
  await router.isReady();
  return { wrapper, router };
}

function dialog(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]');
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('страница «Мои доски»', () => {
  it('показывает пустое состояние без досок', async () => {
    const { wrapper } = await mountApp(
      makeFetch({ 'GET /api/boards?archived=false': () => json(200, { boards: [] }) }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('У вас пока нет личных досок'));
  });

  it('показывает список личных досок со ссылкой', async () => {
    const { wrapper } = await mountApp(
      makeFetch({
        'GET /api/boards?archived=false': () =>
          json(200, { boards: [{ ...activeBoard, itemCount: 0 }] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Личная доска'));
    expect(wrapper.find('a[href="/boards/b1"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Командная');
  });

  it('помечает плашкой с именем команды доски, созданные от лица команды', async () => {
    const teamBoard: Board = { ...activeBoard, id: 'b2', teamId: 't1', title: 'Доска команды' };
    const { wrapper } = await mountApp(
      makeFetch({
        'GET /api/boards?archived=false': () =>
          json(200, { boards: [{ ...teamBoard, itemCount: 0 }] }),
        'GET /api/teams': () =>
          json(200, { teams: [{ id: 't1', name: 'Платформа', role: 'member', memberCount: 3 }] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Доска команды'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Платформа'));
  });

  it('ошибка загрузки показывает сообщение', async () => {
    const { wrapper } = await mountApp(
      makeFetch({
        'GET /api/boards?archived=false': () => json(500, { error: 'internal', message: 'сбой' }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Не удалось загрузить доски'));
  });

  it('восстанавливает доску из архива обратно в основной список через кебаб-меню карточки', async () => {
    const archivedBoard: Board = { ...activeBoard, id: 'b3', status: 'archived' };
    const unarchive = vi.fn(() => json(200, { board: { ...archivedBoard, status: 'active' } }));
    const { wrapper } = await mountApp(
      makeFetch({
        'GET /api/boards?archived=false': () => json(200, { boards: [] }),
        'GET /api/boards?archived=true': () =>
          json(200, { boards: [{ ...archivedBoard, itemCount: 0 }] }),
        'POST /api/boards/b3/unarchive': unarchive,
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Активные'));

    const archiveTab = wrapper.findAll('button').find((b) => b.text().trim() === 'Архив');
    await archiveTab!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Личная доска'));

    // Действие спрятано в кебаб-меню карточки — оно телепортируется в document.body
    const menuTrigger = document.body.querySelector('button[aria-label="Меню доски"]');
    (menuTrigger as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Восстановить'));
    const restoreItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Восстановить',
    );
    (restoreItem as HTMLElement).click();

    await vi.waitFor(() => expect(unarchive).toHaveBeenCalled());
    await vi.waitFor(() => expect(wrapper.text()).toContain('В архиве пока нет досок'));

    // Доска должна появиться в основном списке, а не только пропасть из архива
    const activeTab = wrapper.findAll('button').find((b) => b.text().trim() === 'Активные');
    await activeTab!.trigger('click');
    await vi.waitFor(() => expect(wrapper.find('a[href="/boards/b3"]').exists()).toBe(true));
  });

  it('открывает архив и удаляет доску навсегда через кебаб-меню карточки', async () => {
    const archivedBoard: Board = { ...activeBoard, id: 'b3', status: 'archived' };
    const remove = vi.fn(() => new Response(null, { status: 204 }));
    const { wrapper } = await mountApp(
      makeFetch({
        'GET /api/boards?archived=false': () => json(200, { boards: [] }),
        'GET /api/boards?archived=true': () =>
          json(200, { boards: [{ ...archivedBoard, itemCount: 0 }] }),
        'DELETE /api/boards/b3': remove,
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Активные'));

    const archiveTab = wrapper.findAll('button').find((b) => b.text().trim() === 'Архив');
    await archiveTab!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Личная доска'));

    const menuTrigger = document.body.querySelector('button[aria-label="Меню доски"]');
    (menuTrigger as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Удалить навсегда'));
    const deleteItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Удалить навсегда',
    );
    (deleteItem as HTMLElement).click();
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Удалить доску навсегда?'));

    const confirmButton = Array.from(dialog()?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === 'Удалить навсегда',
    );
    confirmButton!.click();

    await vi.waitFor(() => expect(remove).toHaveBeenCalled());
    await vi.waitFor(() => expect(dialog()).toBeNull());
  });
});
