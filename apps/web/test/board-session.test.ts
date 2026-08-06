import type {
  BoardEdge,
  BoardItem,
  BoardOpsBatch,
  BoardPresenceEntry,
  JoinBoardResult,
} from '@poker/shared';
import { BOARD_WS_EVENTS, BOARD_WS_SERVER_EVENTS } from '@poker/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBoardSessionStore } from '../src/stores/board-session';

/** Фальшивый сокет: запоминает подписки и отправленные события (по образцу stores/room.ts) */
class FakeSocket {
  connected = false;
  readonly sent: Array<{ event: string; payload: unknown }> = [];
  private readonly listeners = new Map<string, Array<(payload: never) => void>>();
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

  emit(event: string, payload: unknown, ack?: (result: unknown) => void): void {
    this.sent.push({ event, payload });
    ack?.(
      this.nextError === null ? { ok: true, data: this.next } : { ok: false, ...this.nextError },
    );
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

function item(over: Partial<BoardItem> = {}): BoardItem {
  return {
    id: 'i1',
    boardId: 'board1',
    parentId: null,
    x: 0,
    y: 0,
    width: 160,
    height: 120,
    rotation: 0,
    zIndex: 0,
    content: { type: 'sticky', text: 'Привет' },
    style: { color: '#FCEB96' },
    createdBy: 'u1',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...over,
  };
}

function edge(over: Partial<BoardEdge> = {}): BoardEdge {
  return {
    id: 'e1',
    boardId: 'board1',
    sourceItemId: 'i1',
    targetItemId: 'i2',
    sourceHandle: null,
    targetHandle: null,
    label: null,
    style: { color: '#A8CAFF', line: 'straight' },
    ...over,
  };
}

function snapshotResult(
  revision: number,
  items: BoardItem[] = [],
  edges: BoardEdge[] = [],
): JoinBoardResult {
  return {
    revision,
    snapshot: { board: {} as never, items, edges },
    catchup: null,
  };
}

describe('стор сессии доски', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    socket = new FakeSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('вход применяет снимок и подключает сокет', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(3, [item()], [edge()]);

    await store.join('board1');

    expect(store.revision).toBe(3);
    expect(store.items.map((i) => i.id)).toEqual(['i1']);
    expect(store.edges.map((e) => e.id)).toEqual(['e1']);
    expect(socket.connected).toBe(true);
    expect(store.joined).toBe(true);
  });

  it('вход применяет догон операциями вместо снимка, если сервер его прислал', async () => {
    const store = useBoardSessionStore();
    const batch: BoardOpsBatch = {
      revision: 5,
      ops: [{ type: 'item.create', clientOpId: 'c1', item: item() }],
    };
    socket.next = { revision: 5, snapshot: null, catchup: [batch] } satisfies JoinBoardResult;

    await store.join('board1');

    expect(store.revision).toBe(5);
    expect(store.items.map((i) => i.id)).toEqual(['i1']);
  });

  it('applyOps шлёт операции и возвращает новую ревизию', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(1);
    await store.join('board1');
    socket.next = { revision: 2 };

    const revision = await store.applyOps([
      { type: 'item.create', clientOpId: 'c1', item: item() },
    ]);

    expect(revision).toBe(2);
    expect(socket.sent.at(-1)).toMatchObject({ event: BOARD_WS_EVENTS.APPLY });
  });

  it('не даёт применять операции без входа на доску', async () => {
    const store = useBoardSessionStore();

    await expect(
      store.applyOps([{ type: 'item.delete', clientOpId: 'c1', id: 'i1' }]),
    ).rejects.toThrow('Доска не подключена');
  });

  describe('оптимистичное применение и эхо (12.6)', () => {
    it('создание элемента отражается локально сразу, не дожидаясь рассылки board:ops', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');
      socket.next = { revision: 2 };

      await store.applyOps([{ type: 'item.create', clientOpId: 'c1', item: item() }]);

      // Эхо (board:ops) не приходило — элемент появился именно из оптимистичного применения
      expect(store.items.map((i) => i.id)).toEqual(['i1']);
      expect(store.revision).toBe(1);
    });

    it('эхо устаревшей своей операции не откатывает более свежую локальную правку той же цели', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item({ x: 0 })]);
      await store.join('board1');

      socket.next = { revision: 2 };
      await store.applyOps([{ type: 'item.patch', clientOpId: 'a', id: 'i1', patch: { x: 10 } }]);
      socket.next = { revision: 3 };
      await store.applyOps([{ type: 'item.patch', clientOpId: 'b', id: 'i1', patch: { x: 20 } }]);
      expect(store.items[0]?.x).toBe(20);

      // Эхо более старой операции 'a' долетает первым (типичный порядок для последовательной
      // отправки) — не должно откатить уже показанные 20 обратно к 10
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.OPS, {
        revision: 2,
        ops: [{ type: 'item.patch', clientOpId: 'a', item: item({ x: 10 }) }],
      } satisfies BoardOpsBatch);
      expect(store.items[0]?.x).toBe(20);
      expect(store.revision).toBe(2);

      // Эхо последней операции 'b' — применяется и снимает пометку "своя в полёте"
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.OPS, {
        revision: 3,
        ops: [{ type: 'item.patch', clientOpId: 'b', item: item({ x: 20 }) }],
      } satisfies BoardOpsBatch);
      expect(store.items[0]?.x).toBe(20);
      expect(store.revision).toBe(3);
    });

    it('чужая операция по той же цели применяется всегда, независимо от своих операций в полёте', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item({ x: 0 })]);
      await store.join('board1');

      socket.next = { revision: 2 };
      await store.applyOps([{ type: 'item.patch', clientOpId: 'a', id: 'i1', patch: { x: 10 } }]);

      // Чужая операция (clientOpId, который мы не отправляли) — не участвует в
      // проверке "своя в полёте", применяется как обычное эхо
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.OPS, {
        revision: 2,
        ops: [{ type: 'item.patch', clientOpId: 'someone-else', item: item({ x: 99 }) }],
      } satisfies BoardOpsBatch);

      expect(store.items[0]?.x).toBe(99);
    });
  });

  describe('приём рассылок board:ops', () => {
    it('применяет батч со следующей ревизией', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      socket.emitLocal(BOARD_WS_SERVER_EVENTS.OPS, {
        revision: 2,
        ops: [{ type: 'item.create', clientOpId: 'c1', item: item() }],
      } satisfies BoardOpsBatch);

      expect(store.revision).toBe(2);
      expect(store.items.map((i) => i.id)).toEqual(['i1']);
    });

    it('отбрасывает отставший или уже применённый батч', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(5);
      await store.join('board1');

      socket.emitLocal(BOARD_WS_SERVER_EVENTS.OPS, {
        revision: 5,
        ops: [{ type: 'item.create', clientOpId: 'c1', item: item() }],
      } satisfies BoardOpsBatch);

      expect(store.revision).toBe(5);
      expect(store.items).toHaveLength(0);
    });
  });

  it('принимает список присутствия', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(1);
    await store.join('board1');

    const entries: BoardPresenceEntry[] = [{ userId: 'u1', name: 'Иван', avatarUrl: null }];
    socket.emitLocal(BOARD_WS_SERVER_EVENTS.PRESENCE, entries);

    expect(store.presence).toEqual(entries);
  });

  it('после выхода забывает состояние доски', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(3, [item()]);
    await store.join('board1');

    store.leave();

    expect(store.items).toHaveLength(0);
    expect(store.revision).toBe(0);
    expect(store.joined).toBe(false);
    expect(socket.connected).toBe(false);
  });

  it('после переподключения заново входит на доску с sinceRevision', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(4);
    await store.join('board1');
    socket.sent.length = 0;

    socket.disconnect();
    socket.next = snapshotResult(4);
    socket.connect();
    await Promise.resolve();

    expect(socket.sent[0]).toMatchObject({
      event: BOARD_WS_EVENTS.JOIN,
      payload: { boardId: 'board1', sinceRevision: 4 },
    });
  });

  it('при переходе на другую доску сбрасывает прошлое состояние', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(2, [item()]);
    await store.join('board1');

    socket.next = snapshotResult(1, [item({ id: 'i2', boardId: 'board2' })]);
    await store.join('board2');

    expect(store.items.map((i) => i.id)).toEqual(['i2']);
  });
});
