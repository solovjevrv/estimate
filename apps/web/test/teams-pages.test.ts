import ui from '@nuxt/ui/vue-plugin';
import type { AuthUser, Room, TeamMember, TeamWithRole } from '@poker/shared';
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

const admin: TeamMember = {
  userId: 'u1',
  name: 'Иван',
  email: 'ivan@example.com',
  avatarUrl: null,
  role: 'admin',
  joinedAt: '2026-07-24T00:00:00.000Z',
};

const teamA: TeamWithRole = {
  id: 't1',
  name: 'Команда А',
  createdAt: '2026-07-24T00:00:00.000Z',
  role: 'admin',
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

/** Незаснятые инстансы копятся между тестами и замедляют файл под нагрузкой CI */
let activeWrapper: ReturnType<typeof mount> | null = null;

async function mountApp(path: string, fetchImpl: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchImpl);
  const pinia = createPinia();
  const router = createAppRouter(createMemoryHistory());
  const wrapper = mount(App, {
    global: { plugins: [pinia, router, createAppI18n('ru'), ui] },
    attachTo: document.body,
  });
  activeWrapper = wrapper;
  await router.push(path);
  await router.isReady();
  return { wrapper, router };
}

function byText(wrapper: ReturnType<typeof mount>, selector: string, text: string) {
  return wrapper.findAll(selector).find((el) => el.text().trim() === text);
}

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
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
    expect(wrapper.text()).toContain('Администратор');
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
  it('показывает состав и блок приглашения администратору', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () =>
          json(200, { team: teamA, role: 'admin', members: [admin], inviteCode: 'abcdef' }),
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
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'member', members: [admin] }),
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
          json(200, { team: teamA, role: 'admin', members: [admin], inviteCode: 'abcdef' }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Приглашение'));

    await byText(wrapper, 'button', 'Скопировать ссылку')!.trigger('click');

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/invite/abcdef'));
  });
});

const other: TeamMember = {
  userId: 'u2',
  name: 'Пётр',
  email: 'petr@example.com',
  avatarUrl: null,
  role: 'member',
  joinedAt: '2026-07-24T00:00:00.000Z',
};

/** Открытая модалка Nuxt UI телепортируется в body под role="dialog" */
function dialog(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]');
}

function dialogButton(text: string): HTMLButtonElement | undefined {
  return Array.from(dialog()?.querySelectorAll('button') ?? []).find(
    (b) => b.textContent?.trim() === text,
  );
}

describe('управление составом', () => {
  it('администратору доступно исключение других участников', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () =>
          json(200, { team: teamA, role: 'admin', members: [admin, other] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Пётр'));
    // Кнопка исключения есть у чужого участника и отсутствует у самого администратора
    expect(wrapper.findAll('[aria-label="Исключить"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('Удалить команду');
    // Селект роли есть только у чужого участника, себе администратор роль не меняет
    expect(wrapper.findAll('[aria-label="Роль"]')).toHaveLength(1);
  });

  it('обычному участнику управление недоступно', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () =>
          json(200, { team: teamA, role: 'member', members: [admin, other] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Состав'));
    expect(wrapper.find('[aria-label="Исключить"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Удалить команду');
    expect(wrapper.text()).not.toContain('Переименовать');
  });

  it('исключение участника убирает его из состава', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () =>
          json(200, { team: teamA, role: 'admin', members: [admin, other] }),
        'DELETE /api/teams/t1/members/u2': () => new Response(null, { status: 204 }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Пётр'));

    await wrapper.find('[aria-label="Исключить"]').trigger('click');
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Исключить участника?'));
    dialogButton('Исключить')!.click();

    await vi.waitFor(() => expect(wrapper.text()).not.toContain('Пётр'));
  });

  it('выход из команды уводит на список команд', async () => {
    const { wrapper, router } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        // Текущий пользователь u1 — обычный участник, администратор другой
        'GET /api/teams/t1': () =>
          json(200, {
            team: teamA,
            role: 'member',
            members: [
              { ...other, role: 'admin' },
              { ...admin, role: 'member' },
            ],
          }),
        'GET /api/teams': () => json(200, { teams: [] }),
        'DELETE /api/teams/t1/members/u1': () => new Response(null, { status: 204 }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Состав'));

    await byText(wrapper, 'button', 'Выйти из команды')!.trigger('click');
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Выйти из команды?'));
    dialogButton('Выйти')!.click();

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('teams'));
  });

  it('администратор может выйти из команды, если есть другой администратор', async () => {
    const { wrapper, router } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () =>
          json(200, { team: teamA, role: 'admin', members: [admin, { ...other, role: 'admin' }] }),
        'GET /api/teams': () => json(200, { teams: [] }),
        'DELETE /api/teams/t1/members/u1': () => new Response(null, { status: 204 }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Настройки команды'));

    await byText(wrapper, 'button', 'Выйти из команды')!.trigger('click');
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Выйти из команды?'));
    dialogButton('Выйти')!.click();

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('teams'));
  });

  it('единственному администратору бэкенд отказывает выйти — показывает уведомление', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'admin', members: [admin] }),
        'DELETE /api/teams/t1/members/u1': () =>
          json(409, {
            error: 'conflict',
            message: 'В команде должен остаться хотя бы один администратор',
          }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Настройки команды'));

    await byText(wrapper, 'button', 'Выйти из команды')!.trigger('click');
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Выйти из команды?'));
    dialogButton('Выйти')!.click();

    await vi.waitFor(() => expect(wrapper.text()).toContain('Вы единственный администратор'));
  });

  it('удаление команды уводит на список команд', async () => {
    const { wrapper, router } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'admin', members: [admin] }),
        'GET /api/teams': () => json(200, { teams: [] }),
        'DELETE /api/teams/t1': () => new Response(null, { status: 204 }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Удалить команду'));

    await byText(wrapper, 'button', 'Удалить команду')!.trigger('click');
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Удалить команду?'));
    dialogButton('Удалить')!.click();

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('teams'));
  });

  it('переименование обновляет заголовок команды', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'admin', members: [admin] }),
        'PATCH /api/teams/t1': () => json(200, { team: { ...teamA, name: 'Новое имя' } }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Настройки команды'));

    await byText(wrapper, 'button', 'Переименовать')!.trigger('click');
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Переименовать команду'));

    const input = dialog()!.querySelector('input') as HTMLInputElement;
    input.value = 'Новое имя';
    input.dispatchEvent(new Event('input'));
    dialogButton('Переименовать')!.click();

    await vi.waitFor(() => expect(wrapper.find('h1').text()).toBe('Новое имя'));
  });
});

const activeRoom: Room = {
  id: 'r1',
  teamId: 't1',
  creatorId: 'u1',
  name: 'Планирование спринта',
  status: 'active',
  revision: 0,
  createdAt: '2026-07-24T00:00:00.000Z',
  archivedAt: null,
};

const closedRoom: Room = {
  ...activeRoom,
  id: 'r2',
  name: 'Ретро квартала',
  status: 'closed',
  createdAt: '2026-07-20T00:00:00.000Z',
};

describe('дашборд команды', () => {
  it('показывает активные и завершённые комнаты со ссылками', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'admin', members: [admin] }),
        'GET /api/teams/t1/rooms': () => json(200, { rooms: [activeRoom, closedRoom] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Планирование спринта'));
    expect(wrapper.text()).toContain('Ретро квартала');
    expect(wrapper.text()).toContain('Активные');
    expect(wrapper.text()).toContain('Завершённые');
    expect(wrapper.find('a[href="/rooms/r1"]').exists()).toBe(true);
    expect(wrapper.find('a[href="/rooms/r2"]').exists()).toBe(true);
  });

  it('показывает пустое состояние, когда комнат нет', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'admin', members: [admin] }),
        'GET /api/teams/t1/rooms': () => json(200, { rooms: [] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('В команде пока нет комнат'));
  });

  it('переход между командами не показывает комнаты прежней', async () => {
    const teamB: TeamWithRole = { ...teamA, id: 't2', name: 'Команда Б' };
    const roomB: Room = { ...activeRoom, id: 'r9', name: 'Планёрка команды Б' };
    const { wrapper, router } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'admin', members: [admin] }),
        'GET /api/teams/t1/rooms': () => json(200, { rooms: [activeRoom] }),
        'GET /api/teams/t2': () => json(200, { team: teamB, role: 'admin', members: [admin] }),
        'GET /api/teams/t2/rooms': () => json(200, { rooms: [roomB] }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Планирование спринта'));

    await router.push('/teams/t2');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Планёрка команды Б'));
    expect(wrapper.text()).not.toContain('Планирование спринта');
  });

  it('ошибка загрузки комнат не прячет команду', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'admin', members: [admin] }),
        'GET /api/teams/t1/rooms': () => json(500, { error: 'internal', message: 'сбой' }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Состав'));
    expect(wrapper.text()).toContain('Не удалось загрузить комнаты команды');
  });
});

describe('архив комнат команды', () => {
  it('рядовому участнику раздел архива не показывается', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'member', members: [admin] }),
        'GET /api/teams/t1/rooms': () => json(200, { rooms: [] }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Состав'));
    expect(wrapper.text()).not.toContain('Показать архив');
  });

  it('администратор открывает архив и удаляет комнату навсегда', async () => {
    const archivedRoom: Room = { ...activeRoom, id: 'r7', archivedAt: '2026-07-25T00:00:00.000Z' };
    const remove = vi.fn(() => new Response(null, { status: 204 }));
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'admin', members: [admin] }),
        'GET /api/teams/t1/rooms': () => json(200, { rooms: [] }),
        'GET /api/teams/t1/rooms?archived=true': () => json(200, { rooms: [archivedRoom] }),
        'DELETE /api/rooms/r7': remove,
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Показать архив'));

    await byText(wrapper, 'button', 'Показать архив')!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Планирование спринта'));

    await byText(wrapper, 'button', 'Удалить навсегда')!.trigger('click');
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Удалить комнату навсегда?'));
    dialogButton('Удалить навсегда')!.click();

    await vi.waitFor(() => expect(remove).toHaveBeenCalled());
    // Ждём, пока стор довершит правки (тост + перезагрузка архива), прежде чем тест уйдёт дальше
    await vi.waitFor(() => expect(dialog()).toBeNull());
  });
});

describe('создание комнаты команды', () => {
  it('администратору доступна кнопка создания, участнику — нет', async () => {
    const { wrapper } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'member', members: [admin] }),
        'GET /api/teams/t1/rooms': () => json(200, { rooms: [] }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('В команде пока нет комнат'));
    expect(wrapper.text()).not.toContain('Создать комнату');
  });

  it('администратор создаёт комнату от лица команды и переходит в неё', async () => {
    const created: Room = { ...activeRoom, id: 'r5', teamId: 't1', name: 'Новая комната' };
    const { wrapper, router } = await mountApp(
      '/teams/t1',
      makeFetch(true, {
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'admin', members: [admin] }),
        'GET /api/teams/t1/rooms': () => json(200, { rooms: [] }),
        'GET /api/rooms/r5': () => json(200, { room: created }),
        'POST /api/rooms': () => json(201, { room: created }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('В команде пока нет комнат'));

    await byText(wrapper, 'button', 'Создать комнату')!.trigger('click');
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Новая комната'));

    const input = dialog()!.querySelector('input') as HTMLInputElement;
    input.value = 'Новая комната';
    input.dispatchEvent(new Event('input'));
    dialogButton('Создать комнату')!.click();

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rooms/r5'));
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
        'GET /api/teams/t1': () => json(200, { team: teamA, role: 'member', members: [admin] }),
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
