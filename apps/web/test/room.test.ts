import type { JoinRoomResult, Room, RoomState, RoomTimerState, Round } from '@poker/shared';
import { TIMER_DEFAULT_DURATION_SEC, WS_EVENTS, WS_SERVER_EVENTS } from '@poker/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRoomStore } from '../src/stores/room';

/** Фальшивый сокет: запоминает подписки и отправленные события */
class FakeSocket {
  connected = false;
  readonly sent: Array<{ event: string; payload: unknown }> = [];
  private readonly listeners = new Map<string, Array<(payload: never) => void>>();
  /** Что вернуть на очередное событие; ошибка отдаётся как отказ сервера */
  next: unknown = null;
  nextError: { error: string; message: string } | null = null;

  connect(): void {
    this.connected = true;
    this.emitLocal('connect', undefined);
  }

  disconnect(reason: string = 'io client disconnect'): void {
    this.connected = false;
    this.emitLocal('disconnect', reason);
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
    ack(this.nextError === null ? { ok: true, data: this.next } : { ok: false, ...this.nextError });
  }

  /** Рассылка сервера участникам комнаты */
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

function round(overrides: Partial<Round> = {}): Round {
  return {
    id: 'r1',
    roomId: 'room1',
    seq: 1,
    deckType: 'fibonacci',
    status: 'voting',
    average: null,
    createdAt: '2026-07-23T10:00:00.000Z',
    revealedAt: null,
    ...overrides,
  };
}

function timer(overrides: Partial<RoomTimerState> = {}): RoomTimerState {
  return {
    durationSec: TIMER_DEFAULT_DURATION_SEC,
    running: false,
    endsAt: null,
    remainingSec: TIMER_DEFAULT_DURATION_SEC,
    ...overrides,
  };
}

function roomFixture(revision: number, overrides: Partial<Room> = {}): Room {
  return {
    id: 'room1',
    teamId: null,
    creatorId: 'u1',
    name: 'Спринт 14',
    status: 'active',
    revision,
    createdAt: '2026-07-23T10:00:00.000Z',
    archivedAt: null,
    jiraUrl: null,
    confluenceUrl: null,
    linksVersion: 1,
    ...overrides,
  };
}

function state(revision: number, overrides: Partial<RoomState> = {}): RoomState {
  return {
    room: roomFixture(revision),
    round: round(),
    participants: [],
    result: null,
    timer: timer(),
    ...overrides,
  };
}

describe('стор комнаты', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    socket = new FakeSocket();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('порядок снимков', () => {
    it('принимает снимок с большим номером изменения', () => {
      const store = useRoomStore();
      store.applyState(state(5));

      store.applyState(state(6));

      expect(store.room?.revision).toBe(6);
    });

    it('отбрасывает снимок, отставший от показанного', () => {
      const store = useRoomStore();
      store.applyState(state(7));

      store.applyState(state(3));

      expect(store.room?.revision).toBe(7);
    });

    it('принимает снимок с тем же номером: он мог прийти в ответе на действие', () => {
      const store = useRoomStore();
      store.applyState(state(4, { participants: [] }));

      store.applyState(
        state(4, {
          participants: [
            {
              participantId: 'p1',
              name: 'Иван',
              avatarUrl: null,
              isGuest: false,
              role: 'voter',
              hasVoted: true,
            },
          ],
        }),
      );

      expect(store.participants).toHaveLength(1);
    });

    it('не сравнивает номера разных комнат', () => {
      const store = useRoomStore();
      store.applyState(state(9));

      const other = state(1);
      other.room.id = 'room2';
      store.applyState(other);

      expect(store.room?.id).toBe('room2');
    });
  });

  describe('вход в комнату', () => {
    it('применяет снимок из ответа и запоминает участника', async () => {
      const store = useRoomStore();
      const joined: JoinRoomResult = {
        state: state(2),
        guestToken: null,
        participantId: 'p1',
      };
      socket.next = joined;

      await store.join('room1');

      expect(store.participantId).toBe('p1');
      expect(store.room?.revision).toBe(2);
      expect(socket.connected).toBe(true);
    });

    it('сохраняет токен гостя и присылает его при следующем входе', async () => {
      const store = useRoomStore();
      socket.next = {
        state: state(1),
        guestToken: 'секрет',
        participantId: 'p2',
      } satisfies JoinRoomResult;

      await store.join('room1', 'Гость');
      store.leave();

      socket = new FakeSocket();
      socket.next = {
        state: state(1),
        guestToken: 'секрет',
        participantId: 'p2',
      } satisfies JoinRoomResult;
      await useRoomStore().join('room1');

      expect(socket.sent[0]?.payload).toMatchObject({ roomId: 'room1', guestToken: 'секрет' });
    });

    it('переживает недоступное хранилище: вход проходит без токена', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('хранилище недоступно');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('хранилище недоступно');
      });
      const store = useRoomStore();
      socket.next = {
        state: state(1),
        guestToken: 'секрет',
        participantId: 'p3',
      } satisfies JoinRoomResult;

      await store.join('room1', 'Гость');

      expect(store.participantId).toBe('p3');
      expect(socket.sent[0]?.payload).toMatchObject({ guestToken: undefined });
    });

    it('принимает рассылки состояния после входа', async () => {
      const store = useRoomStore();
      socket.next = { state: state(1), guestToken: null, participantId: 'p1' };
      await store.join('room1');

      socket.emitLocal(WS_SERVER_EVENTS.ROOM_STATE, state(2));

      expect(store.room?.revision).toBe(2);
    });

    it('после выхода забывает стол', async () => {
      const store = useRoomStore();
      socket.next = { state: state(1), guestToken: null, participantId: 'p1' };
      await store.join('room1');

      store.leave();

      expect(store.state).toBeNull();
      expect(store.participantId).toBeNull();
      expect(socket.connected).toBe(false);
    });

    it('после переподключения заново входит в комнату, чтобы вернуть место за столом', async () => {
      const store = useRoomStore();
      socket.next = { state: state(1), guestToken: null, participantId: 'p1' };
      await store.join('room1');
      socket.sent.length = 0;

      // Сеть моргнула: обрыв и новое соединение
      socket.disconnect();
      socket.next = { state: state(2), guestToken: null, participantId: 'p1' };
      socket.connect();
      await Promise.resolve();

      expect(socket.sent[0]).toMatchObject({
        event: WS_EVENTS.JOIN_ROOM,
        payload: { roomId: 'room1' },
      });
    });

    it('при провале автоматического входа после переподключения зовёт onReconnectFailure (7.16)', async () => {
      const store = useRoomStore();
      const onReconnectFailure = vi.fn();
      socket.next = { state: state(1), guestToken: null, participantId: 'p1' };
      await store.join('room1', undefined, onReconnectFailure);
      socket.sent.length = 0;

      // Сеть моргнула, а за это время протух access-токен: хэндшейк видит гостя без имени
      socket.disconnect();
      socket.nextError = { error: 'unauthorized', message: 'Гостю нужно имя' };
      socket.connect();
      await Promise.resolve();
      await Promise.resolve();

      expect(onReconnectFailure).toHaveBeenCalledOnce();
      expect(store.participantId).toBe('p1'); // прошлое состояние не затирается неудачным входом
    });

    it('переподключается сам, если сервер разорвал соединение из-за истёкшего токена (7.7)', async () => {
      const store = useRoomStore();
      socket.next = { state: state(1), guestToken: null, participantId: 'p1' };
      await store.join('room1');
      socket.sent.length = 0;

      // Сервер сам рвёт сокет по истечении access-токена — единственная причина,
      // на которую socket.io-client не переподключается сам (7.7)
      socket.next = { state: state(2), guestToken: null, participantId: 'p1' };
      socket.disconnect('io server disconnect');
      await Promise.resolve();
      await Promise.resolve();

      expect(socket.connected).toBe(true);
      expect(socket.sent[0]).toMatchObject({
        event: WS_EVENTS.JOIN_ROOM,
        payload: { roomId: 'room1' },
      });
    });

    it('не переподключается сам при обычном обрыве — это забота клиента socket.io', async () => {
      const store = useRoomStore();
      socket.next = { state: state(1), guestToken: null, participantId: 'p1' };
      await store.join('room1');
      socket.sent.length = 0;

      socket.disconnect('transport close');
      await Promise.resolve();
      await Promise.resolve();

      expect(socket.connected).toBe(false);
      expect(socket.sent.length).toBe(0);
    });

    it('на первом подключении входит один раз, без лишнего повторного входа', async () => {
      const store = useRoomStore();
      socket.next = { state: state(1), guestToken: null, participantId: 'p1' };

      await store.join('room1');

      const joins = socket.sent.filter((s) => s.event === WS_EVENTS.JOIN_ROOM);
      expect(joins).toHaveLength(1);
    });

    it('при переходе в другую комнату сбрасывает прошлый стол', async () => {
      const store = useRoomStore();
      socket.next = { state: state(5), guestToken: null, participantId: 'p1' };
      await store.join('room1');

      const other = state(1);
      other.room.id = 'room2';
      socket.next = { state: other, guestToken: null, participantId: 'p9' };
      await store.join('room2');

      expect(store.room?.id).toBe('room2');
      expect(store.participantId).toBe('p9');
    });
  });

  describe('действия за столом', () => {
    beforeEach(async () => {
      socket.next = { state: state(1), guestToken: null, participantId: 'p1' };
      await useRoomStore().join('room1');
      socket.sent.length = 0;
    });

    it('к оценке прикладывает раунд, который участник видел; ответ на голос — пустой', async () => {
      const store = useRoomStore();
      // Сервер на голос отвечает null — состояние придёт рассылкой room_state
      socket.next = null;

      await store.submitVote(5);

      expect(socket.sent[0]).toEqual({
        event: WS_EVENTS.SUBMIT_VOTE,
        payload: { value: 5, roundId: 'r1' },
      });
    });

    it('к вскрытию карт прикладывает раунд и возвращает итоги раунда', async () => {
      const store = useRoomStore();
      const summary = { average: 5, min: 3, max: 8, votes: [] };
      // Ответ на вскрытие — RoundResult, а не полный снимок стола
      socket.next = summary;

      const result = await store.revealCards();

      expect(socket.sent[0]).toEqual({
        event: WS_EVENTS.REVEAL_CARDS,
        payload: { roundId: 'r1' },
      });
      expect(result).toEqual(summary);
    });

    it('к новому раунду прикладывает текущий, чтобы двойной клик не создал лишний', async () => {
      const store = useRoomStore();
      socket.next = round({ id: 'r2', seq: 2 });

      const created = await store.startNewRound('scale_0_5');

      expect(socket.sent[0]).toEqual({
        event: WS_EVENTS.START_NEW_ROUND,
        payload: { deckType: 'scale_0_5', fromRoundId: 'r1' },
      });
      expect(created.id).toBe('r2');
    });

    it('к правке ссылок прикладывает версию комнаты; ответ — пустой', async () => {
      const store = useRoomStore();
      store.applyState(state(2, { room: roomFixture(2, { linksVersion: 4 }) }));
      // Сервер на правку ссылок отвечает null — новая версия придёт рассылкой
      socket.next = null;

      await store.updateLinks({ jiraUrl: 'https://jira.example/PP-1' });

      expect(socket.sent[0]).toEqual({
        event: WS_EVENTS.UPDATE_LINKS,
        payload: { jiraUrl: 'https://jira.example/PP-1', version: 4 },
      });
    });

    it('отказ сервера доходит до вызывающего кода с кодом ошибки', async () => {
      const store = useRoomStore();
      socket.nextError = { error: 'conflict', message: 'Ссылки уже изменили' };

      await expect(
        store.updateLinks({ jiraUrl: 'https://jira.example/PP-2' }),
      ).rejects.toMatchObject({ code: 'conflict', message: 'Ссылки уже изменили' });
    });

    it('явно переданная версия перекрывает версию из уже обновившейся комнаты', async () => {
      const store = useRoomStore();
      store.applyState(state(2, { room: roomFixture(2, { linksVersion: 4 }) }));
      // Пока где-то держали черновик на версии 4, кто-то другой уже сохранил правки —
      // версия в сторе уехала вперёд раньше, чем черновик отправили на сохранение
      store.applyState(state(3, { room: roomFixture(3, { linksVersion: 5 }) }));
      socket.next = null;

      await store.updateLinks({ jiraUrl: 'https://jira.example/PP-1', version: 4 });

      expect(socket.sent[0]).toEqual({
        event: WS_EVENTS.UPDATE_LINKS,
        payload: { jiraUrl: 'https://jira.example/PP-1', version: 4 },
      });
    });

    it('не даёт действовать без подключения к комнате', async () => {
      const store = useRoomStore();
      store.leave();

      await expect(store.submitVote(3)).rejects.toThrow('Комната не подключена');
    });

    it('таймер: старт, пауза и сброс шлют события без прав — состояние придёт рассылкой', async () => {
      const store = useRoomStore();
      socket.next = null;

      await store.startTimer();
      expect(socket.sent[0]).toEqual({ event: WS_EVENTS.START_TIMER, payload: {} });

      await store.pauseTimer();
      expect(socket.sent[1]).toEqual({ event: WS_EVENTS.PAUSE_TIMER, payload: {} });

      await store.resetTimer(600);
      expect(socket.sent[2]).toEqual({
        event: WS_EVENTS.RESET_TIMER,
        payload: { durationSec: 600 },
      });
    });

    it('таймер по умолчанию (комната ещё не присылала снимок с ним): дефолт 5 минут', () => {
      const store = useRoomStore();
      store.leave();

      expect(store.timer).toEqual({
        durationSec: TIMER_DEFAULT_DURATION_SEC,
        running: false,
        endsAt: null,
        remainingSec: TIMER_DEFAULT_DURATION_SEC,
      });
    });
  });
});
