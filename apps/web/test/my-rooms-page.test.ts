import ui from '@nuxt/ui/vue-plugin';
import type { AuthUser, Room } from '@estimate/shared';
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

const activeRoom: Room = {
  id: 'r1',
  teamId: null,
  creatorId: 'u1',
  name: 'Личная комната',
  status: 'active',
  revision: 0,
  createdAt: '2026-07-24T00:00:00.000Z',
  archivedAt: null,
  jiraUrl: null,
  confluenceUrl: null,
  linksVersion: 1,
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
  await router.push('/my-rooms');
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

describe('страница «Мои комнаты»', () => {
  it('показывает пустое состояние без комнат', async () => {
    const { wrapper } = await mountApp(
      makeFetch({ 'GET /api/rooms?archived=false': () => json(200, { rooms: [] }) }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Вы пока не создали ни одной комнаты'));
  });

  it('показывает список личных комнат со ссылкой', async () => {
    const { wrapper } = await mountApp(
      makeFetch({
        'GET /api/rooms?archived=false': () => json(200, { rooms: [activeRoom] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Личная комната'));
    expect(wrapper.find('a[href="/rooms/r1"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Командная');
  });

  it('помечает плашкой с именем команды комнаты, созданные от лица команды', async () => {
    const teamRoom: Room = { ...activeRoom, id: 'r3', teamId: 't1', name: 'Планёрка команды' };
    const { wrapper } = await mountApp(
      makeFetch({
        'GET /api/rooms?archived=false': () => json(200, { rooms: [teamRoom] }),
        'GET /api/teams': () =>
          json(200, { teams: [{ id: 't1', name: 'Платформа', role: 'member', memberCount: 3 }] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Планёрка команды'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Платформа'));
  });

  it('ошибка загрузки показывает сообщение', async () => {
    const { wrapper } = await mountApp(
      makeFetch({
        'GET /api/rooms?archived=false': () => json(500, { error: 'internal', message: 'сбой' }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Не удалось загрузить комнаты'));
  });

  it('не показывает пагинацию, пока комнат 5 или меньше', async () => {
    const rooms = Array.from({ length: 5 }, (_, i) => ({
      ...activeRoom,
      id: `r${i}`,
      name: `Комната ${i}`,
      createdAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const { wrapper } = await mountApp(
      makeFetch({ 'GET /api/rooms?archived=false': () => json(200, { rooms }) }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Комната 4'));
    const pageTwoButton = wrapper.findAll('button').find((b) => b.text().trim() === '2');
    expect(pageTwoButton).toBeUndefined();
  });

  it('при более чем 5 активных комнатах показывает пагинацию и листает страницы', async () => {
    const rooms = Array.from({ length: 8 }, (_, i) => ({
      ...activeRoom,
      id: `r${i}`,
      name: `Комната ${i}`,
      createdAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const { wrapper } = await mountApp(
      makeFetch({ 'GET /api/rooms?archived=false': () => json(200, { rooms }) }),
    );

    // Сортировка — свежие сверху, свежая это i=7 ("Комната 7"), первая страница — 7..3
    await vi.waitFor(() => expect(wrapper.text()).toContain('Комната 7'));
    expect(wrapper.text()).not.toContain('Комната 2');

    const pageTwoButton = wrapper.findAll('button').find((b) => b.text().trim() === '2');
    expect(pageTwoButton).toBeTruthy();
    await pageTwoButton!.trigger('click');

    expect(wrapper.text()).toContain('Комната 2');
    expect(wrapper.text()).not.toContain('Комната 7');
  });

  it('открывает архив и удаляет комнату навсегда через кебаб-меню строки', async () => {
    const archivedRoom: Room = { ...activeRoom, id: 'r2', archivedAt: '2026-07-25T00:00:00.000Z' };
    const remove = vi.fn(() => new Response(null, { status: 204 }));
    const { wrapper } = await mountApp(
      makeFetch({
        'GET /api/rooms?archived=false': () => json(200, { rooms: [] }),
        'GET /api/rooms?archived=true': () => json(200, { rooms: [archivedRoom] }),
        'DELETE /api/rooms/r2': remove,
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Активные'));

    const archiveTab = wrapper.findAll('button').find((b) => b.text().trim() === 'Архив');
    await archiveTab!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Личная комната'));

    // Действие спрятано в кебаб-меню строки — оно телепортируется в document.body
    const menuTrigger = document.body.querySelector('button[aria-label="Меню комнаты"]');
    (menuTrigger as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Удалить навсегда'));
    const deleteItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Удалить навсегда',
    );
    (deleteItem as HTMLElement).click();
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Удалить комнату навсегда?'));

    const confirmButton = Array.from(dialog()?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === 'Удалить навсегда',
    );
    confirmButton!.click();

    await vi.waitFor(() => expect(remove).toHaveBeenCalled());
    await vi.waitFor(() => expect(dialog()).toBeNull());
  });
});
