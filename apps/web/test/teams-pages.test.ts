import ui from '@nuxt/ui/vue-plugin';
import type { AuthUser, TeamMember, TeamWithRole } from '@poker/shared';
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
  avatarUrl: null,
};

const owner: TeamMember = {
  userId: 'u1',
  name: 'Иван',
  email: 'ivan@example.com',
  avatarUrl: null,
  role: 'owner',
  joinedAt: '2026-07-24T00:00:00.000Z',
};

const teamA: TeamWithRole = {
  id: 't1',
  name: 'Команда А',
  createdAt: '2026-07-24T00:00:00.000Z',
  role: 'owner',
};

type Handlers = Record<string, () => Response>;

/** fetch с ответами под конкретные роуты и разумными значениями по умолчанию */
function makeFetch(authenticated: boolean, handlers: Handlers = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = handlers[`${method} ${url}`];
    if (handler) return Promise.resolve(handler());
    if (url === '/api/me') {
      return Promise.resolve(
        authenticated ? json(200, { user }) : json(401, { error: 'unauthorized', message: 'нет' }),
      );
    }
    if (url === '/api/auth/refresh') {
      return Promise.resolve(json(401, { error: 'unauthorized', message: 'нет' }));
    }
    if (url === '/api/auth/providers') {
      return Promise.resolve(json(200, { providers: ['google', 'yandex'] }));
    }
    return Promise.resolve(json(404, { error: 'not_found', message: 'нет' }));
  });
}

async function mountApp(path: string, fetchImpl: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchImpl);
  const pinia = createPinia();
  const router = createAppRouter(createMemoryHistory());
  const wrapper = mount(App, {
    global: { plugins: [pinia, router, createAppI18n('ru'), ui] },
    attachTo: document.body,
  });
  await router.push(path);
  await router.isReady();
  return { wrapper, router };
}

function byText(wrapper: ReturnType<typeof mount>, selector: string, text: string) {
  return wrapper.findAll(selector).find((el) => el.text().trim() === text);
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('страница команд', () => {
  it('показывает список команд с ролью', async () => {
    const { wrapper } = await mountApp(
      '/teams',
      makeFetch(true, {
        'GET /api/teams': () => json(200, { teams: [teamA] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Команда А'));
    expect(wrapper.text()).toContain('Владелец');
  });

  it('показывает пустое состояние, когда команд нет', async () => {
    const { wrapper } = await mountApp(
      '/teams',
      makeFetch(true, {
        'GET /api/teams': () => json(200, { teams: [] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('У вас пока нет команд'));
  });

  it('открывает модалку создания команды', async () => {
    const { wrapper } = await mountApp(
      '/teams',
      makeFetch(true, {
        'GET /api/teams': () => json(200, { teams: [] }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('У вас пока нет команд'));

    await byText(wrapper, 'button', 'Создать команду')!.trigger('click');

    // Контент модалки телепортируется в body
    await vi.waitFor(() => expect(document.body.textContent).toContain('Новая команда'));
  });
});

describe('карточка команды', () => {
  it('показывает состав и блок приглашения владельцу', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () =>
          json(200, { team: teamA, role: 'owner', members: [owner], inviteCode: 'abcdef' }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Состав'));
    expect(wrapper.text()).toContain('Иван');
    expect(wrapper.text()).toContain('Приглашение');
    const invite = wrapper.find('input[readonly]');
    expect(invite.exists()).toBe(true);
    expect((invite.element as HTMLInputElement).value).toContain('/invite/abcdef');
  });

  it('не показывает блок приглашения обычному участнику', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'member', members: [owner] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Состав'));
    expect(wrapper.text()).not.toContain('Приглашение');
  });

  it('на чужую или несуществующую команду показывает «не найдено»', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(404, { error: 'not_found', message: 'нет' }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Команда не найдена'));
  });

  it('копирует ссылку-приглашение в буфер', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () =>
          json(200, { team: teamA, role: 'owner', members: [owner], inviteCode: 'abcdef' }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Приглашение'));

    await byText(wrapper, 'button', 'Скопировать ссылку')!.trigger('click');

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/invite/abcdef'));
  });
});

describe('страница приглашения', () => {
  it('гостю показывает команду и предлагает войти', async () => {
    const { wrapper } = await mountApp(
      '/invite/abcdef',
      makeFetch(false, {
        'GET /api/invites/abcdef': () => json(200, { team: { id: 't1', name: 'Команда А' } }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Команда А'));
    expect(wrapper.text()).toContain('Войти и вступить');
  });

  it('гостя по кнопке уводит на вход с возвратом на приглашение', async () => {
    const { wrapper, router } = await mountApp(
      '/invite/abcdef',
      makeFetch(false, {
        'GET /api/invites/abcdef': () => json(200, { team: { id: 't1', name: 'Команда А' } }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Войти и вступить'));

    await byText(wrapper, 'button', 'Войти и вступить')!.trigger('click');

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'));
    expect(router.currentRoute.value.query.redirect).toBe('/invite/abcdef');
  });

  it('вошедшего вступает в команду и ведёт на её страницу', async () => {
    const { wrapper, router } = await mountApp(
      '/invite/abcdef',
      makeFetch(true, {
        'GET /api/invites/abcdef': () => json(200, { team: { id: 't1', name: 'Команда А' } }),
        'POST /api/invites/abcdef/join': () => json(200, { team: teamA, role: 'member' }),
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'member', members: [owner] }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Вступить'));

    await byText(wrapper, 'button', 'Вступить')!.trigger('click');

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('team'));
    expect(router.currentRoute.value.params.id).toBe('t1');
  });

  it('на неверное приглашение показывает «не найдено»', async () => {
    const { wrapper } = await mountApp(
      '/invite/zzz',
      makeFetch(false, {
        'GET /api/invites/zzz': () => json(404, { error: 'not_found', message: 'нет' }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Приглашение не найдено'));
  });
});
