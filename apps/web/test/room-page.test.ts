import ui from '@nuxt/ui/vue-plugin';
import type { AuthUser, Participant, Room, RoomState, Round, RoundResult } from '@poker/shared';
import { TIMER_DEFAULT_DURATION_SEC, WS_SERVER_EVENTS } from '@poker/shared';
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
  jobTitle: null,
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
  archivedAt: null,
};

function roomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    room: room1,
    round: null,
    participants: [],
    result: null,
    timer: {
      durationSec: TIMER_DEFAULT_DURATION_SEC,
      running: false,
      endsAt: null,
      remainingSec: TIMER_DEFAULT_DURATION_SEC,
    },
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

beforeEach(() => {
  socket = new FakeSocket();
});

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
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

    await vi.waitFor(() => expect(wrapper.text()).toContain('Участники'));
    const join = socket.sent.find((s) => s.event === 'join_room');
    expect(join?.payload).toMatchObject({ roomId: 'r1', guestName: 'Мария' });
  });

  it('вошедшего пользователя заводит в комнату без формы имени', async () => {
    socket.next = { state: roomState(), guestToken: null, participantId: 'u1' };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Участники'));
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

    await vi.waitFor(() => expect(wrapper.text()).toContain('Участники'));
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
    // Бейдж соединения — иконка без текста (7.21), текст доступен через aria-label/tooltip
    await vi.waitFor(() => expect(wrapper.find('[aria-label="Подключено"]').exists()).toBe(true));

    socket.disconnect();

    await vi.waitFor(() =>
      expect(wrapper.find('[aria-label="Обрыв соединения"]').exists()).toBe(true),
    );
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Участники'));
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
    // Ссылкам нечего редактировать — раунда ещё нет
    expect(wrapper.text()).not.toContain('Ссылки на задачу');
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
    expect(wrapper.text()).toContain('Ждём: Мария');
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
    // Имя авторизованного участника теперь есть и в шапке — ждём именно вход
    // в комнату (запись в столе участников), а не первое появление имени на странице
    await vi.waitFor(() => expect(wrapper.text()).toContain('Раунд ещё не начат'));
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

    const scaleTab = wrapper.findAll('button').find((b) => b.text().trim() === 'Шкала 0–5');
    await scaleTab!.trigger('click');

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

  it('скрам-мастер запускает раунд с колодой футболочных размеров', async () => {
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

    const tshirtTab = wrapper.findAll('button').find((b) => b.text().trim() === 'Футболки');
    await tshirtTab!.trigger('click');

    const activeRound = round({ deckType: 'tshirt' });
    socket.next = activeRound;
    const startButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Начать раунд');
    await startButton!.trigger('click');

    const started = socket.sent.find((s) => s.event === 'start_new_round');
    expect(started?.payload).toMatchObject({ deckType: 'tshirt', fromRoundId: null });
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

function roundResult(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    average: 5,
    min: 3,
    max: 8,
    agreement: 50,
    votes: [
      { participantId: 'u1', name: 'Иван', value: 5 },
      { participantId: 'g1', name: 'Мария', value: 8 },
    ],
    ...overrides,
  };
}

describe('вскрытие карт', () => {
  it('скрам-мастер видит кнопку вскрытия, голосующий — нет', async () => {
    socket.next = {
      state: roomState({
        round: round(),
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

    await vi.waitFor(() => expect(wrapper.text()).toContain('Ваша оценка'));
    expect(wrapper.text()).not.toContain('Вскрыть карты');
  });

  it('вскрытие показывает результаты всем и прячет карты голосования', async () => {
    socket.next = {
      state: roomState({
        round: round(),
        participants: [
          participant({
            participantId: 'u1',
            name: 'Иван',
            role: 'scrum_master',
            hasVoted: true,
          }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Вскрыть карты'));

    socket.next = roundResult();
    const revealButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Вскрыть карты');
    await revealButton!.trigger('click');

    const revealed = socket.sent.find((s) => s.event === 'reveal_cards');
    expect(revealed?.payload).toMatchObject({ roundId: 'rnd1' });

    // Результат приходит всем через рассылку — не через прямой ответ на вскрытие
    socket.emitLocal(
      WS_SERVER_EVENTS.ROOM_STATE,
      roomState({
        room: { ...room1, revision: room1.revision + 1 },
        round: round({ status: 'revealed', average: 5 }),
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
        result: roundResult(),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Результаты раунда'));
    expect(wrapper.text()).not.toContain('Ваша оценка');
    expect(wrapper.text()).toContain('Мария');
    expect(wrapper.text()).toContain('8');
  });

  it('колода футболочных размеров: карты и результаты в буквах, среднего нет, есть согласие', async () => {
    socket.next = {
      state: roomState({
        round: round({ deckType: 'tshirt' }),
        participants: [
          participant({
            participantId: 'u1',
            name: 'Иван',
            role: 'scrum_master',
            hasVoted: true,
          }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ваша оценка'));

    // Карты подписаны буквами размеров, а не числами
    expect(wrapper.findAll('button').find((b) => b.text().trim() === 'M')).toBeDefined();
    expect(wrapper.findAll('button').find((b) => b.text().trim() === '3')).toBeUndefined();

    socket.next = roundResult({ average: null, min: 3, max: 3, agreement: 100 });
    const revealButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Вскрыть карты');
    await revealButton!.trigger('click');

    socket.emitLocal(
      WS_SERVER_EVENTS.ROOM_STATE,
      roomState({
        room: { ...room1, revision: room1.revision + 1 },
        round: round({ deckType: 'tshirt', status: 'revealed', average: null }),
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
        result: roundResult({
          average: null,
          min: 3,
          max: 3,
          agreement: 100,
          votes: [{ participantId: 'u1', name: 'Иван', value: 3 }],
        }),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Согласие: 100%'));
    expect(wrapper.text()).not.toContain('Среднее:');
    expect(wrapper.text()).toContain('Мин: M');
    expect(wrapper.text()).toContain('Макс: M');
  });

  it('подсвечивает карточки победителей (самое частое значение) и показывает его в результатах', async () => {
    socket.next = {
      state: roomState({
        round: round(),
        participants: [
          participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master', hasVoted: true }),
          participant({ participantId: 'g1', name: 'Мария', isGuest: true, hasVoted: true }),
          participant({ participantId: 'g2', name: 'Пётр', isGuest: true, hasVoted: true }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Вскрыть карты'));

    const revealResult = roundResult({
      average: 4.3,
      min: 3,
      max: 5,
      agreement: 67,
      votes: [
        { participantId: 'u1', name: 'Иван', value: 5 },
        { participantId: 'g1', name: 'Мария', value: 5 },
        { participantId: 'g2', name: 'Пётр', value: 3 },
      ],
    });
    socket.next = revealResult;
    const revealButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Вскрыть карты');
    await revealButton!.trigger('click');

    socket.emitLocal(
      WS_SERVER_EVENTS.ROOM_STATE,
      roomState({
        room: { ...room1, revision: room1.revision + 1 },
        round: round({ status: 'revealed', average: 4.3 }),
        participants: [
          participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' }),
          participant({ participantId: 'g1', name: 'Мария', isGuest: true }),
          participant({ participantId: 'g2', name: 'Пётр', isGuest: true }),
        ],
        result: revealResult,
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Победитель'));
    const winnerValue = wrapper.findAll('span').find((s) => s.text().trim() === '5');
    expect(winnerValue).toBeDefined();

    const winnerCards = wrapper.findAll('[data-winner="true"]');
    expect(winnerCards).toHaveLength(2);
    expect(winnerCards.some((c) => c.text().includes('Иван'))).toBe(true);
    expect(winnerCards.some((c) => c.text().includes('Мария'))).toBe(true);
    expect(winnerCards.some((c) => c.text().includes('Пётр'))).toBe(false);
  });

  it('при ничьей никого не подсвечивает победителем', async () => {
    socket.next = {
      state: roomState({
        round: round(),
        participants: [
          participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master', hasVoted: true }),
          participant({ participantId: 'g1', name: 'Мария', isGuest: true, hasVoted: true }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Вскрыть карты'));

    socket.next = roundResult();
    const revealButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Вскрыть карты');
    await revealButton!.trigger('click');

    socket.emitLocal(
      WS_SERVER_EVENTS.ROOM_STATE,
      roomState({
        room: { ...room1, revision: room1.revision + 1 },
        round: round({ status: 'revealed', average: 5 }),
        participants: [
          participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' }),
          participant({ participantId: 'g1', name: 'Мария', isGuest: true }),
        ],
        result: roundResult(),
      }),
    );

    await vi.waitFor(() => expect(wrapper.text()).toContain('Результаты раунда'));
    expect(wrapper.text()).not.toContain('Победитель');
    expect(wrapper.findAll('[data-winner="true"]')).toHaveLength(0);
  });

  it('при ошибке вскрытия показывает уведомление', async () => {
    socket.next = {
      state: roomState({
        round: round(),
        participants: [
          participant({
            participantId: 'u1',
            name: 'Иван',
            role: 'scrum_master',
            hasVoted: true,
          }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Вскрыть карты'));

    socket.nextError = { error: 'conflict', message: 'Никто ещё не проголосовал' };
    const revealButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Вскрыть карты');
    await revealButton!.trigger('click');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Не удалось вскрыть карты'));
  });

  it('показывает счётчик проголосовавших', async () => {
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

    await vi.waitFor(() => expect(wrapper.text()).toContain('Проголосовало: 1 из 2'));
  });

  it('вскрытие при неполном голосовании просит подтверждение, а после него вскрывает карты', async () => {
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Проголосовало: 1 из 2'));

    const revealButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Вскрыть карты');
    await revealButton!.trigger('click');
    await vi.waitFor(() => expect(document.body.textContent).toContain('Проголосовали не все'));
    expect(socket.sent.some((s) => s.event === 'reveal_cards')).toBe(false);

    socket.next = roundResult();
    const confirmButton = Array.from(
      document.body.querySelector('[role="dialog"]')?.querySelectorAll('button') ?? [],
    ).find((b) => b.textContent?.trim() === 'Вскрыть карты');
    confirmButton!.click();

    await vi.waitFor(() => expect(socket.sent.some((s) => s.event === 'reveal_cards')).toBe(true));
  });
});

describe('новый раунд и отмена раунда', () => {
  it('после вскрытия скрам-мастер видит «Новый раунд» и запускает следующую задачу', async () => {
    socket.next = {
      state: roomState({
        round: round({ status: 'revealed', average: 5 }),
        result: roundResult(),
        participants: [
          participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master', hasVoted: true }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Результаты раунда'));

    const nextRound = round({ id: 'rnd2', seq: 2 });
    socket.next = nextRound;
    const startButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Новый раунд');
    await startButton!.trigger('click');

    const started = socket.sent.find((s) => s.event === 'start_new_round');
    expect(started?.payload).toMatchObject({ fromRoundId: 'rnd1' });
  });

  it('отмена раунда без голосов запускает новый сразу, без вопроса', async () => {
    socket.next = {
      state: roomState({
        round: round(),
        participants: [
          participant({
            participantId: 'u1',
            name: 'Иван',
            role: 'scrum_master',
            hasVoted: false,
          }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Отменить раунд'));

    const nextRound = round({ id: 'rnd2', seq: 2 });
    socket.next = nextRound;
    const cancelButton = wrapper
      .findAll('button')
      .find((b) => b.text().trim() === 'Отменить раунд');
    await cancelButton!.trigger('click');

    const started = socket.sent.find((s) => s.event === 'start_new_round');
    expect(started?.payload).toMatchObject({ fromRoundId: 'rnd1' });
    expect(document.body.textContent).not.toContain('Отменить голосование?');
    // 7.23: тихий перезапуск визуально неотличим от старого раунда — тост подтверждает, что клик сработал
    await vi.waitFor(() => expect(document.body.textContent).toContain('Раунд перезапущен'));
  });

  it('отмена раунда с уже поставленными голосами требует подтверждения', async () => {
    socket.next = {
      state: roomState({
        round: round(),
        participants: [
          participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master', hasVoted: true }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Отменить раунд'));

    const cancelButton = wrapper
      .findAll('button')
      .find((b) => b.text().trim() === 'Отменить раунд');
    await cancelButton!.trigger('click');
    await vi.waitFor(() => expect(document.body.textContent).toContain('Отменить голосование?'));
    expect(socket.sent.some((s) => s.event === 'start_new_round')).toBe(false);

    const nextRound = round({ id: 'rnd2', seq: 2 });
    socket.next = nextRound;
    const confirmButton = Array.from(
      document.body.querySelector('[role="dialog"]')?.querySelectorAll('button') ?? [],
    ).find((b) => b.textContent?.trim() === 'Отменить и начать заново');
    confirmButton!.click();

    await vi.waitFor(() =>
      expect(socket.sent.some((s) => s.event === 'start_new_round')).toBe(true),
    );
  });
});

describe('архивация комнаты', () => {
  it('голосующему настройки комнаты не показываются', async () => {
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
    expect(wrapper.text()).not.toContain('Архивировать комнату');
  });

  it('скрам-мастер архивирует комнату, и она становится доступна только для чтения', async () => {
    socket.next = {
      state: roomState({
        round: round(),
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };
    const archivedRoom: Room = { ...room1, revision: 2, archivedAt: '2026-07-25T00:00:00.000Z' };
    const archive = vi.fn(() => json(200, { room: archivedRoom }));

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, {
        'GET /api/rooms/r1': () => json(200, { room: room1 }),
        'POST /api/rooms/r1/archive': archive,
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ваша оценка'));

    // Архивирование теперь спрятано в меню комнаты — оно телепортируется в document.body
    const menuTrigger = document.body.querySelector('button[aria-label="Меню комнаты"]');
    (menuTrigger as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Архивировать комнату'));
    const archiveItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Архивировать комнату',
    );
    (archiveItem as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Архивировать комнату?'));

    const confirmButton = Array.from(
      document.body.querySelector('[role="dialog"]')?.querySelectorAll('button') ?? [],
    ).find((b) => b.textContent?.trim() === 'Архивировать');
    confirmButton!.click();

    await vi.waitFor(() => expect(archive).toHaveBeenCalled());
    await vi.waitFor(() => expect(wrapper.text()).toContain('Комната в архиве'));
    // Читаемо, но действия за столом больше не предлагаются
    expect(wrapper.text()).not.toContain('Ваша оценка');
    expect(wrapper.text()).not.toContain('Архивировать комнату');
  });
});

describe('меню комнаты: копирование ссылки', () => {
  it('пункт «Скопировать ссылку» копирует адрес комнаты в буфер обмена', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    socket.next = {
      state: roomState({
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(document.body.textContent).toContain('Планирование спринта'));

    const menuTrigger = document.body.querySelector('button[aria-label="Меню комнаты"]');
    (menuTrigger as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Скопировать ссылку'));
    const copyItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Скопировать ссылку',
    );
    (copyItem as HTMLElement).click();

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
  });
});

function findLinkInput(wrapper: ReturnType<typeof mount>, hint: string) {
  return wrapper
    .findAll('input')
    .find((el) => el.attributes('placeholder')?.toLowerCase().includes(hint));
}

describe('правка ссылок Jira/Confluence', () => {
  it('показывает текущие ссылки раунда и сохраняет новые', async () => {
    socket.next = {
      state: roomState({
        round: round({ jiraUrl: 'https://jira.example.com/OLD-1' }),
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ссылки на задачу'));

    const jiraInput = findLinkInput(wrapper, 'jira');
    expect((jiraInput!.element as HTMLInputElement).value).toBe('https://jira.example.com/OLD-1');

    const confluenceInput = findLinkInput(wrapper, 'confluence');
    await confluenceInput!.setValue('https://confluence.example.com/NEW');

    socket.next = null;
    await wrapper.find('form').trigger('submit');

    await vi.waitFor(() => expect(socket.sent.some((s) => s.event === 'update_links')).toBe(true));
    const sent = socket.sent.find((s) => s.event === 'update_links');
    expect(sent?.payload).toMatchObject({
      jiraUrl: 'https://jira.example.com/OLD-1',
      confluenceUrl: 'https://confluence.example.com/NEW',
      roundId: 'rnd1',
      version: 1,
    });
  });

  it('не отправляет ссылку неверного формата', async () => {
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ссылки на задачу'));

    const jiraInput = findLinkInput(wrapper, 'jira');
    await jiraInput!.setValue('ftp://not-a-link');
    await wrapper.find('form').trigger('submit');

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Ссылка должна начинаться с http:// или https://'),
    );
    expect(socket.sent.some((s) => s.event === 'update_links')).toBe(false);
  });

  it('при ошибке сохранения показывает уведомление', async () => {
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ссылки на задачу'));

    socket.nextError = { error: 'conflict', message: 'Ссылки уже изменил другой участник' };
    const jiraInput = findLinkInput(wrapper, 'jira');
    await jiraInput!.setValue('https://jira.example.com/X');
    await wrapper.find('form').trigger('submit');

    await vi.waitFor(() => expect(wrapper.text()).toContain('Не удалось сохранить ссылки'));
    // Черновик не теряется при отказе — можно поправить и попробовать снова
    expect((findLinkInput(wrapper, 'jira')!.element as HTMLInputElement).value).toBe(
      'https://jira.example.com/X',
    );
  });

  it('обновляет поля по рассылке, пока нет несохранённого черновика', async () => {
    socket.next = {
      state: roomState({
        round: round({ jiraUrl: null, confluenceUrl: null }),
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ссылки на задачу'));

    // Другой участник сохранил ссылку — рассылка приходит без нашего участия
    socket.emitLocal(
      WS_SERVER_EVENTS.ROOM_STATE,
      roomState({
        room: { ...room1, revision: room1.revision + 1 },
        round: round({ jiraUrl: 'https://jira.example.com/SYNCED', linksVersion: 2 }),
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
    );

    await vi.waitFor(() => {
      const jiraInput = findLinkInput(wrapper, 'jira');
      expect((jiraInput!.element as HTMLInputElement).value).toBe(
        'https://jira.example.com/SYNCED',
      );
    });
  });

  it('не перетирает несохранённый черновик рассылкой от другого участника и шлёт версию черновика, а не свежую', async () => {
    socket.next = {
      state: roomState({
        round: round({ jiraUrl: null, confluenceUrl: null, linksVersion: 1 }),
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ссылки на задачу'));

    const jiraInput = findLinkInput(wrapper, 'jira');
    await jiraInput!.setValue('https://jira.example.com/DRAFT');

    // Кто-то другой успел сохранить свои правки, пока мы печатали — версия в сторе уехала вперёд
    socket.emitLocal(
      WS_SERVER_EVENTS.ROOM_STATE,
      roomState({
        room: { ...room1, revision: room1.revision + 1 },
        round: round({ jiraUrl: 'https://jira.example.com/OTHER', linksVersion: 2 }),
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Черновик на экране не тронут чужой рассылкой
    const jiraInputAfter = findLinkInput(wrapper, 'jira');
    expect((jiraInputAfter!.element as HTMLInputElement).value).toBe(
      'https://jira.example.com/DRAFT',
    );

    // Наше сохранение бьёт версией, на которой основан черновик (1), а не свежей из стора (2) —
    // иначе проверка версии на сервере молча пропустила бы перезапись чужой правки
    socket.nextError = { error: 'conflict', message: 'Ссылки уже изменил другой участник' };
    await wrapper.find('form').trigger('submit');

    await vi.waitFor(() => expect(socket.sent.some((s) => s.event === 'update_links')).toBe(true));
    const sent = socket.sent.find((s) => s.event === 'update_links');
    expect(sent?.payload).toMatchObject({ version: 1 });

    await vi.waitFor(() => expect(wrapper.text()).toContain('Не удалось сохранить ссылки'));
  });

  it('новый раунд сбрасывает черновик прежнего раунда', async () => {
    socket.next = {
      state: roomState({
        round: round({ status: 'revealed', jiraUrl: 'https://jira.example.com/OLD' }),
        result: roundResult(),
        participants: [
          participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master', hasVoted: true }),
        ],
      }),
      guestToken: null,
      participantId: 'u1',
    };

    const { wrapper } = await mountApp(
      '/rooms/r1',
      makeFetch(true, { 'GET /api/rooms/r1': () => json(200, { room: room1 }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('Результаты раунда'));

    const jiraInput = findLinkInput(wrapper, 'jira');
    await jiraInput!.setValue('https://jira.example.com/UNSAVED-DRAFT');

    const nextRound = round({ id: 'rnd2', seq: 2, jiraUrl: null, confluenceUrl: null });
    socket.next = nextRound;
    const startButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Новый раунд');
    await startButton!.trigger('click');

    socket.emitLocal(
      WS_SERVER_EVENTS.ROOM_STATE,
      roomState({
        room: { ...room1, revision: room1.revision + 1 },
        round: nextRound,
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
      }),
    );

    await vi.waitFor(() => {
      const input = findLinkInput(wrapper, 'jira');
      expect((input!.element as HTMLInputElement).value).toBe('');
    });
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Участники'));
    expect(socket.connected).toBe(true);

    // Меню пользователя телепортируется в document.body — ищем через реальный DOM
    const menuTrigger = document.body.querySelector('button[aria-label="Меню пользователя"]');
    (menuTrigger as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Выйти'));
    const logoutItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Выйти',
    );
    (logoutItem as HTMLElement).click();

    // Переход на главную размонтирует RoomPage — onBeforeUnmount закрывает сокет
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'));
    expect(socket.connected).toBe(false);
  });
});

describe('таймер обсуждения', () => {
  it('гость (не скрам-мастер) видит таймер и может его стартовать — прав не проверяем', async () => {
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

    await vi.waitFor(() => expect(wrapper.text()).toContain('Таймер обсуждения'));
    expect(wrapper.text()).toContain('5:00');

    socket.next = null;
    const startButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Старт');
    await startButton!.trigger('click');

    const started = socket.sent.find((s) => s.event === 'start_timer');
    expect(started?.payload).toEqual({});
  });

  it('во время отсчёта кнопка становится «Пауза» и шлёт pause_timer', async () => {
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Таймер обсуждения'));

    socket.emitLocal(
      WS_SERVER_EVENTS.ROOM_STATE,
      roomState({
        room: { ...room1, revision: room1.revision + 1 },
        participants: [participant({ participantId: 'u1', name: 'Иван', role: 'scrum_master' })],
        timer: {
          durationSec: 300,
          running: true,
          endsAt: new Date(Date.now() + 300_000).toISOString(),
          remainingSec: 300,
        },
      }),
    );
    await vi.waitFor(() =>
      expect(wrapper.findAll('button').some((b) => b.text().trim() === 'Пауза')).toBe(true),
    );

    socket.next = null;
    const pauseButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Пауза');
    await pauseButton!.trigger('click');

    const paused = socket.sent.find((s) => s.event === 'pause_timer');
    expect(paused?.payload).toEqual({});
  });

  it('клик по пресету длительности шлёт reset_timer с этой длительностью', async () => {
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Таймер обсуждения'));

    socket.next = null;
    const preset10 = wrapper.findAll('button').find((b) => b.text().trim() === '10 мин');
    await preset10!.trigger('click');

    const reset = socket.sent.find((s) => s.event === 'reset_timer');
    expect(reset?.payload).toEqual({ durationSec: 600 });
  });
});
