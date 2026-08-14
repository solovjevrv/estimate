/**
 * Ядро реалтайм-сессии: до 19.11 этот протокол жил двумя копиями в
 * `stores/room.ts` и `stores/board-session.ts` и проверялся только через них —
 * то есть дважды и по-разному. Теперь копия одна, и она отвечает за место
 * участника за столом и на доске сразу, поэтому проверяется отдельно.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRealtimeConnection, type JoinContext } from '../src/lib/realtime';
import type { PokerSocket } from '../src/lib/socket';

/** Фальшивый сокет: запоминает подписки и умеет сыграть разрыв с любой причиной */
class FakeSocket {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  private readonly listeners = new Map<string, Array<(payload: never) => void>>();

  connect(): void {
    this.connectCalls++;
    this.connected = true;
    this.fire('connect', undefined);
  }

  disconnect(): void {
    this.disconnectCalls++;
    this.connected = false;
  }

  on(event: string, handler: (payload: never) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  /** Разрыв со стороны сети или сервера — с причиной, как её отдаёт socket.io */
  serverDrop(reason: string): void {
    this.connected = false;
    this.fire('disconnect', reason);
  }

  private fire(event: string, payload: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) {
      (handler as (p: unknown) => void)(payload);
    }
  }
}

let socket: FakeSocket;
/** Каждый вызов createSocket отдаёт новый экземпляр — как в бою */
let created: FakeSocket[] = [];

vi.mock('../src/lib/socket', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/socket')>('../src/lib/socket');
  return {
    ...actual,
    createSocket: () => {
      socket = new FakeSocket();
      created.push(socket);
      return socket;
    },
  };
});

interface Recorder {
  attaches: number;
  joins: Array<{ reconnect: boolean; isCurrent: () => boolean }>;
}

function connectionWith(
  options: {
    join?: (socket: PokerSocket, ctx: JoinContext) => Promise<void>;
    shouldReconnect?: () => boolean;
  } = {},
) {
  const recorder: Recorder = { attaches: 0, joins: [] };
  const connection = createRealtimeConnection({
    attach: () => {
      recorder.attaches++;
    },
    join: async (active, ctx) => {
      recorder.joins.push({ reconnect: ctx.reconnect, isCurrent: ctx.isCurrent });
      await options.join?.(active, ctx);
    },
    ...(options.shouldReconnect ? { shouldReconnect: options.shouldReconnect } : {}),
  });
  return { connection, recorder };
}

beforeEach(() => {
  created = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('открытие соединения', () => {
  it('создаёт сокет, подписывает домен, подключается и входит', async () => {
    const { connection, recorder } = connectionWith();

    await connection.open();

    expect(created).toHaveLength(1);
    expect(recorder.attaches).toBe(1);
    expect(socket.connectCalls).toBe(1);
    expect(recorder.joins).toHaveLength(1);
    expect(recorder.joins[0]?.reconnect).toBe(false);
    expect(connection.connected.value).toBe(true);
  });

  it('на первом подключении входит ровно один раз: обработчик connect не должен дублировать вход', async () => {
    const { connection, recorder } = connectionWith();

    await connection.open();

    expect(recorder.joins).toHaveLength(1);
  });

  it('повторное открытие не создаёт второй сокет и не подписывает домен заново', async () => {
    const { connection, recorder } = connectionWith();

    await connection.open();
    await connection.open();

    expect(created).toHaveLength(1);
    expect(recorder.attaches).toBe(1);
    expect(recorder.joins).toHaveLength(2);
    // Сокет уже подключён — повторно дёргать connect() незачем
    expect(socket.connectCalls).toBe(1);
  });

  it('до открытия сокета нет: require бросает, current отдаёт null', () => {
    const { connection } = connectionWith();

    expect(() => connection.require('Не подключено')).toThrow('Не подключено');
    expect(connection.current()).toBeNull();
  });
});

describe('переподключение', () => {
  it('после обрыва входит заново и помечает вход как реконнект', async () => {
    const { connection, recorder } = connectionWith();
    await connection.open();

    socket.serverDrop('transport close');
    expect(connection.connected.value).toBe(false);
    socket.connect();

    expect(recorder.joins).toHaveLength(2);
    expect(recorder.joins[1]?.reconnect).toBe(true);
    expect(connection.connected.value).toBe(true);
  });

  it('провал автоматического входа уходит в onReconnectFailure, а не в необработанный промис (7.16)', async () => {
    const onReconnectFailure = vi.fn();
    const { connection } = connectionWith({
      join: async (_socket, ctx) => {
        if (ctx.reconnect) throw new Error('доступ отозвали, пока вкладка простаивала');
      },
    });
    await connection.open(onReconnectFailure);

    socket.serverDrop('transport close');
    socket.connect();
    // Автоматический вход запущен без await — отказ придёт следующими микротасками
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onReconnectFailure).toHaveBeenCalledTimes(1);
  });

  it('сервер разорвал соединение сам — переподключаемся принудительно (7.7)', async () => {
    const { connection } = connectionWith();
    await connection.open();
    const before = socket.connectCalls;

    socket.serverDrop('io server disconnect');

    expect(socket.connectCalls).toBe(before + 1);
  });

  it('обычный обрыв не трогаем — socket.io вытянет себя сам', async () => {
    const { connection } = connectionWith();
    await connection.open();
    const before = socket.connectCalls;

    socket.serverDrop('transport close');

    expect(socket.connectCalls).toBe(before);
  });

  it('политика домена может запретить возвращаться: исключённого не тащим обратно', async () => {
    let allowed = true;
    const { connection } = connectionWith({ shouldReconnect: () => allowed });
    await connection.open();
    const before = socket.connectCalls;

    allowed = false;
    socket.serverDrop('io server disconnect');

    expect(socket.connectCalls).toBe(before);
  });
});

describe('выход', () => {
  it('закрывает сокет и гасит признак соединения', async () => {
    const { connection } = connectionWith();
    await connection.open();

    connection.close();

    expect(socket.disconnectCalls).toBe(1);
    expect(connection.connected.value).toBe(false);
    expect(connection.current()).toBeNull();
  });

  it('обесценивает вход, который в этот момент ещё ждал ответ сервера', async () => {
    const { connection, recorder } = connectionWith();
    await connection.open();
    const pending = recorder.joins[0];

    expect(pending?.isCurrent()).toBe(true);
    connection.close();
    expect(pending?.isCurrent()).toBe(false);
  });

  it('после выхода следующее открытие заводит новый сокет и подписывает домен заново', async () => {
    const { connection, recorder } = connectionWith();
    await connection.open();

    connection.close();
    await connection.open();

    expect(created).toHaveLength(2);
    expect(recorder.attaches).toBe(2);
  });
});

describe('переустановка соединения (7.7)', () => {
  it('рвёт сокет, но не обесценивает уже идущий вход', async () => {
    const { connection, recorder } = connectionWith();
    await connection.open();
    const pending = recorder.joins[0];

    connection.reset();

    expect(socket.disconnectCalls).toBe(1);
    expect(connection.connected.value).toBe(false);
    // Домен продолжает показывать то же состояние — это по-прежнему его вход
    expect(pending?.isCurrent()).toBe(true);
  });

  it('следующее открытие входит один раз, а не двумя параллельными', async () => {
    const { connection, recorder } = connectionWith();
    await connection.open();

    connection.reset();
    await connection.open();

    // Первый вход + вход после переустановки. Если бы reset не сбрасывал признак
    // состоявшегося соединения, обработчик connect добавил бы третий
    expect(recorder.joins).toHaveLength(2);
    expect(recorder.joins[1]?.reconnect).toBe(false);
  });
});
