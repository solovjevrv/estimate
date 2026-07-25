import ui from '@nuxt/ui/vue-plugin';
import type { AuthUser, Participant, Room, RoomState, Round } from '@poker/shared';
import { WS_SERVER_EVENTS } from '@poker/shared';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const room1: Room = {
  id: 'r1',
  teamId: null,
  creatorId: 'u1',
  name: 'Планирование спринта',
  status: 'active',
  revision: 1,
  createdAt: '2026-07-24T00:00:00.000Z',
};

function roomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    room: room1,
    round: null,
    participants: [],
    result: null,
    ...overrides,
  };
}

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    participantId: 'u1',
    name: 'Иван',
    avatarUrl: null,
    isGuest: false,
    role: 'voter',
    hasVoted: false,
    ...overrides,
  };
}

function round(overrides: Partial<Round> = {}): Round {
  return {
    id: 'rnd1',
    roomId: 'r1',
    seq: 1,
    deckType: 'fibonacci',
    jiraUrl: null,
    confluenceUrl: null,
    linksVersion: 1,
    status: 'voting',
    average: null,
    createdAt: '2026-07-24T00:00:00.000Z',
    revealedAt: null,
    ...overrides,
  };
}

/** Фальшивый сокет: тот же приём, что и в room.test.ts */
class FakeSocket {
  connected = false;
  readonly sent: Array<{ event: string; payload: unknown }> = [];
  private readonly listeners = new Map<string, Array<(payload: never) => void>>();
  next: unknown = null;
  nextError: { error: string; message: string } | null = null;
  /** Следующий emit() не отвечает сразу — ack откладывается до ручного resolveHeldAck() */
  holdNextAck = false;
  private readonly heldAcks: Array<(result: unknown) => void> = [];

  connect(): void {
    this.connected = true;
    this.emitLocal('connect', undefined);
  }

  disconnect(): void {
    this.connected = false;
    this.emitLocal('disconnect', undefined);
  }

  on(event: string, handler: (payload: never) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  hasListeners(event: string): boolean {
    return (this.listeners.get(event)?.length ?? 0) > 0;
  }

  emit(event: string, payload: unknown, ack: (result: unknown) => void): void {
    this.sent.push({ event, payload });
    if (this.holdNextAck) {
      this.holdNextAck = false;
      this.heldAcks.push(ack);
      return;
    }
    ack(this.nextError === null ? { ok: true, data: this.next } : { ok: false, ...this.nextError });
  }

  resolveHeldAck(index: number, result: unknown): void {
    this.heldAcks[index]?.(result);
  }

  emitLocal(event: string, payload: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) {
      (handler as (p: unknown) => void)(payload);
    }
  }
}

let socket: FakeSocket;

vi.mock('../src/lib/socket', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/socket')>('../src/lib/socket');
  return { ...actual, createSocket: () => socket };
});

type Handlers = Record<string, () => Response>;

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

beforeEach(() => {
  socket = new FakeSocket();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('вход в комнату', () => {
  it('гостю показывает форму имени и заходит по WS после отправки', async () => {
    socket.next = { state: roomState(), guestToken: 'tok', participantId: 'g1' };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(false, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Представьтесь'));
    expect(wrapper.text()).toContain('Планирование спринта');

    await wrapper.find('input').setValue('Мария');
    await wrapper.find('form').trigger('submit');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Вы вошли как «Мария»'));
    const join = socket.sent.find((s) => s.event === 'join_room');
    expect(join?.payload).toMatchObject({ roomId: 'r1', guestName: 'Мария' });
  });

  it('вошедшего пользователя заводит в комнату без формы имени', async () => {
    socket.next = { state: roomState(), guestToken: null, participantId: 'u1' };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Вы вошли как «Иван»'));
    expect(wrapper.text()).not.toContain('Представьтесь');
    const join = socket.sent.find((s) => s.event === 'join_room');
    expect(join?.payload).toMatchObject({ roomId: 'r1' });
  });

  it('создателю комнаты показывает роль «Скрам-мастер»', async () => {
    socket.next = {
      state: roomState({
        participants: [participant({ participantId: 'u1', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Скрам-мастер'));
    expect(wrapper.text()).not.toContain('Голосующий');
  });

  it('гостю показывает роль «Голосующий»', async () => {
    socket.next = {
      state: roomState({
        participants: [
          participant({ participantId: 'g1', name: 'Мария', isGuest: true, role: 'voter' }),
        ],
      }),
      guestToken: 'tok',
      participantId: 'g1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(false, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Представьтесь'));
    await wrapper.find('input').setValue('Мария');
    await wrapper.find('form').trigger('submit');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Голосующий'));
    expect(wrapper.text()).not.toContain('Скрам-мастер');
  });

  it('на несуществующую комнату показывает «не найдено»', async () => {
    const { wrapper } = await mountApp(
      '/rooms/zzz',
      makeFetch(true, {
        'GET /api/rooms/zzz': () => json(404, { error: 'not_found', message: 'нет' }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Комната не найдена'));
  });

  it('при отказе входа показывает ошибку и позволяет повторить', async () => {
    socket.nextError = { error: 'forbidden', message: 'нет доступа' };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Не удалось войти в комнату'));

    socket.nextError = null;
    socket.next = { state: roomState(), guestToken: null, participantId: 'u1' };
    const retryButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Повторить');
    await retryButton!.trigger('click');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Вы вошли как «Иван»'));
  });

  it('гостю после отказа входа «Повторить» возвращает к форме имени', async () => {
    socket.nextError = { error: 'forbidden', message: 'нет доступа' };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(false, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Представьтесь'));
    await wrapper.find('input').setValue('Мария');
    await wrapper.find('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Не удалось войти в комнату'));

    const retryButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Повторить');
    await retryButton!.trigger('click');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Представьтесь'));
  });

  it('после обрыва соединения бейдж показывает разрыв', async () => {
    socket.next = { state: roomState(), guestToken: null, participantId: 'u1' };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Подключено'));

    socket.disconnect();

    await vi.waitFor(() => expect(wrapper.text()).toContain('Обрыв соединения'));
  });

  it('быстрый переход между комнатами не показывает результат прежней', async () => {
    let resolveRoom1: (() => void) | null = null;
    const room1Pending = new Promise<Response>((resolve) => {
      resolveRoom1 = () => resolve(json(200, { room: room1 }));
    });
    const room2: Room = { ...room1, id: 'r2', name: 'Ретро квартала' };
    socket.next = { state: roomState({ room: room2 }), guestToken: null, participantId: 'u1' };

    const fetchImpl = vi.fn((url: string) => {
      if (url === '/api/rooms/r1') return room1Pending;
      if (url === '/api/rooms/r2') return Promise.resolve(json(200, { room: room2 }));
      if (url === '/api/me') return Promise.resolve(json(200, { user }));
      if (url === '/api/auth/refresh') {
        return Promise.resolve(json(401, { error: 'unauthorized', message: 'нет' }));
      }
      if (url === '/api/auth/providers') {
        return Promise.resolve(json(200, { providers: ['google', 'yandex'] }));
      }
      return Promise.resolve(json(404, { error: 'not_found', message: 'нет' }));
    });

    const { wrapper, router } = await mountApp('/rooms/r1', fetchImpl);

    // Комната r1 ещё грузится (её ответ не пришёл), а пользователь уже ушёл в r2
    await router.push('/rooms/r2');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Вы вошли как «Иван»'));
    expect(wrapper.text()).toContain('Ретро квартала');

    // Отставший ответ по r1 приходит последним — он не должен подменить экран r2
    resolveRoom1!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.text()).toContain('Ретро квартала');
    expect(wrapper.text()).not.toContain('Планирование спринта');
  });
});

describe('стол участников', () => {
  it('без раунда показывает список без статуса голосования', async () => {
    socket.next = {
      state: roomState({
        participants: [
          participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' }),
          participant({ participantId: 'g1', name: 'Мария', isGuest: true, role: 'voter' }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Раунд ещё не начат'));
    expect(wrapper.text()).toContain('Иван');
    expect(wrapper.text()).toContain('(вы)');
    expect(wrapper.text()).toContain('Мария');
    expect(wrapper.text()).toContain('Гость');
    expect(wrapper.text()).not.toContain('Проголосовал');
    expect(wrapper.text()).not.toContain('Ожидаем');
  });

  it('с активным раундом показывает статус голосования каждого', async () => {
    socket.next = {
      state: roomState({
        round: round(),
        participants: [
          participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master', hasVoted: true }),
          participant({ participantId: 'g1', name: 'Мария', isGuest: true, hasVoted: false }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Проголосовал'));
    expect(wrapper.text()).toContain('Ожидаем');
    expect(wrapper.text()).not.toContain('Раунд ещё не начат');
  });

  it('участник, подключившийся позже, появляется в столе без перезахода', async () => {
    socket.next = {
      state: roomState({
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Иван'));
    expect(wrapper.text()).not.toContain('Мария');

    // Рассылка сервера о новом участнике — стол обновляется без действий пользователя
    socket.emitLocal(
      WS_SERVER_EVENTS.ROOM_STATE,
      roomState({
        room: { ...room1, revision: room1.revision + 1 },
        participants: [
          participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' }),
          participant({ participantId: 'g1', name: 'Мария', isGuest: true }),
        ],
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Мария'));
  });
});

describe('выбор колоды и голосование', () => {
  it('скрам-мастер без раунда видит выбор колоды, голосующий — нет', async () => {
    socket.next = {
      state: roomState({
        participants: [
          participant({ participantId: 'g1', name: 'Мария', isGuest: true, role: 'voter' }),
        ],
      }),
      guestToken: 'tok',
      participantId: 'g1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(false, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Представьтесь'));
    await wrapper.find('input').setValue('Мария');
    await wrapper.find('form').trigger('submit');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Раунд ещё не начат'));
    expect(wrapper.text()).not.toContain('Начать раунд');
  });

  it('скрам-мастер выбирает колоду и запускает раунд', async () => {
    socket.next = {
      state: roomState({
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Начать раунд'));

    const scaleRadio = wrapper.findAll('button[role="radio"]')[1];
    await scaleRadio!.trigger('click');

    const activeRound = round({ deckType: 'scale_0_5' });
    socket.next = activeRound;
    const startButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Начать раунд');
    await startButton!.trigger('click');

    const started = socket.sent.find((s) => s.event === 'start_new_round');
    expect(started?.payload).toMatchObject({ deckType: 'scale_0_5', fromRoundId: null });

    // Раунд появляется у всех через рассылку, а не через прямой ответ на запуск
    socket.emitLocal(
      WS_SERVER_EVENTS.ROOM_STATE,
      roomState({
        room: { ...room1, revision: room1.revision + 1 },
        round: activeRound,
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Ваша оценка'));
    // Шкала 0-5, а не Фибоначчи
    expect(wrapper.text()).toContain('0');
    expect(wrapper.text()).not.toContain('13');
  });

  it('нажатие на карту отправляет голос и подсвечивает выбор', async () => {
    socket.next = {
      state: roomState({
        round: round(),
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ваша оценка'));

    socket.next = null;
    const card = wrapper.findAll('button').find((b) => b.text().trim() === '5');
    await card!.trigger('click');

    const voted = socket.sent.find((s) => s.event === 'submit_vote');
    expect(voted?.payload).toMatchObject({ value: 5, roundId: 'rnd1' });
    expect(card!.classes().join(' ')).toContain('bg-primary');
  });

  it('опоздавший отказ по старому голосу не затирает уже выбранную новую карту', async () => {
    socket.next = {
      state: roomState({
        round: round(),
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ваша оценка'));

    const findCard = (label: string) =>
      wrapper.findAll('button').find((b) => b.text().trim() === label)!;

    // Голос за «5» уходит, но сервер пока не отвечает
    socket.holdNextAck = true;
    await findCard('5').trigger('click');

    // Пока ждём ответа, передумали и проголосовали за «8» — этот ack приходит сразу
    socket.next = null;
    await findCard('8').trigger('click');
    expect(findCard('8').classes().join(' ')).toContain('bg-primary');

    // Только теперь долетает отказ по «5» — он не должен откатить уже выбранную «8»
    socket.resolveHeldAck(0, { ok: false, error: 'conflict', message: 'опоздал' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Не удалось отправить оценку'));
    expect(findCard('8').classes().join(' ')).toContain('bg-primary');
    expect(findCard('5').classes().join(' ')).not.toContain('bg-primary');
  });
});

describe('выход из аккаунта на странице комнаты', () => {
  it('логаут в шапке закрывает WS-сессию комнаты', async () => {
    socket.next = {
      state: roomState({
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper, router } = await mountApp(
      '/rooms/r1',
      makeFetch(true, {
        'GET /api/rooms/r1': () => json(200, { room: room1 }),
        'POST /api/auth/logout': () => json(200, {}),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Вы вошли как «Иван»'));
    expect(socket.connected).toBe(true);

    const logoutButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Выйти');
    await logoutButton!.trigger('click');

    // Переход на главную размонтирует RoomPage — onBeforeUnmount закрывает сокет
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'));
    expect(socket.connected).toBe(false);
  });
});
