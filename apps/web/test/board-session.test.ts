import type {
  BoardAwarenessBroadcast,
  BoardEdge,
  BoardItem,
  BoardOpsBatch,
  BoardPresenceEntry,
  JoinBoardResult,
} from '@poker/shared';
import { BOARD_WS_EVENTS, BOARD_WS_SERVER_EVENTS, type Board } from '@poker/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBoardSessionStore } from '../src/stores/board-session';
import { useSessionStore } from '../src/stores/session';

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
    reactions: [],
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
    style: {
      color: '#A8CAFF',
      line: 'straight',
      dash: 'solid',
      markerStart: 'none',
      markerEnd: 'none',
    },
    ...over,
  };
}

function snapshotResult(
  revision: number,
  items: BoardItem[] = [],
  edges: BoardEdge[] = [],
  participantId = 'actor1',
): JoinBoardResult {
  return {
    revision,
    snapshot: { board: { shareRole: null } as Board, items, edges, access: 'manage' },
    catchup: null,
    access: 'manage',
    participantId,
    guestToken: null,
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
    socket.next = {
      revision: 5,
      snapshot: null,
      catchup: [batch],
      access: 'manage',
      participantId: 'actor1',
      guestToken: null,
    } satisfies JoinBoardResult;

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

  describe('откат при отказе сервера (14.4)', () => {
    it('сервер отклонил патч (например, доступ по ссылке урезали до view) — локальная правка откатывается', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item({ x: 0, y: 0 })]);
      await store.join('board1');
      socket.nextError = { error: 'not_found', message: 'Доска не найдена' };

      await expect(
        store.applyOps([{ type: 'item.patch', clientOpId: 'c1', id: 'i1', patch: { x: 100 } }]),
      ).rejects.toThrow();

      // Оптимистично применённый сдвиг x отменён — холст не должен молча
      // разъезжаться с сервером до перезагрузки страницы
      expect(store.items[0]?.x).toBe(0);
      expect(store.applyError).toEqual({ code: 'not_found' });
    });

    it('сервер отклонил создание элемента — оно откатывается целиком (элемент исчезает)', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');
      socket.nextError = { error: 'forbidden', message: 'Нет прав редактировать эту доску' };

      await expect(
        store.applyOps([{ type: 'item.create', clientOpId: 'c1', item: item() }]),
      ).rejects.toThrow();

      expect(store.items).toHaveLength(0);
      expect(store.applyError).toEqual({ code: 'forbidden' });
    });
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

    it('оптимистичный item.patch мержит style по полям, а не заменяет целиком (12.9)', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item({ style: { color: '#FCEB96', fontSize: 24 } })]);
      await store.join('board1');

      socket.next = { revision: 2 };
      await store.applyOps([
        { type: 'item.patch', clientOpId: 'a', id: 'i1', patch: { style: { color: '#A8CAFF' } } },
      ]);

      // Патч тронул только color — fontSize из предыдущего style должен уцелеть локально,
      // не дожидаясь эха: раньше item.patch спреддил patch.style поверх ЦЕЛОГО item,
      // теряя остальные поля style, если патч указывал не все сразу (баг для edge.patch
      // уже чинили раньше — здесь тот же класс ошибки для item.patch)
      expect(store.items[0]?.style).toEqual({ color: '#A8CAFF', fontSize: 24 });
    });
  });

  describe('реакции item.react (12.12)', () => {
    it('оптимистично предсказывает добавление своей реакции тем же toggle, что и сервер', async () => {
      const session = useSessionStore();
      session.setUser({
        id: 'me',
        provider: 'google',
        email: 'me@example.com',
        name: 'Я',
        jobTitle: null,
        avatarUrl: null,
      });
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item({ reactions: [] })], [], 'me');
      await store.join('board1');
      socket.next = { revision: 2 };

      await store.applyOps([{ type: 'item.react', clientOpId: 'r1', id: 'i1', emoji: '👍' }], {
        record: false,
      });

      // Эхо не приходило — реакция появилась именно из оптимистичного предсказания,
      // тем же toggle (`toggleItemReaction`), что применит сервер
      expect(store.items[0]?.reactions).toEqual([{ userId: 'me', name: 'Я', emoji: '👍' }]);
    });

    it('повторная присылка того же эмодзи локально снимает реакцию', async () => {
      const session = useSessionStore();
      session.setUser({
        id: 'me',
        provider: 'google',
        email: 'me@example.com',
        name: 'Я',
        jobTitle: null,
        avatarUrl: null,
      });
      const store = useBoardSessionStore();
      socket.next = snapshotResult(
        1,
        [item({ reactions: [{ userId: 'me', name: 'Я', emoji: '👍' }] })],
        [],
        'me',
      );
      await store.join('board1');
      socket.next = { revision: 2 };

      await store.applyOps([{ type: 'item.react', clientOpId: 'r1', id: 'i1', emoji: '👍' }], {
        record: false,
      });

      expect(store.items[0]?.reactions).toEqual([]);
    });

    it('реакции не попадают в стек undo/redo', async () => {
      const session = useSessionStore();
      session.setUser({
        id: 'me',
        provider: 'google',
        email: 'me@example.com',
        name: 'Я',
        jobTitle: null,
        avatarUrl: null,
      });
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item({ reactions: [] })], [], 'me');
      await store.join('board1');
      socket.next = { revision: 2 };

      await store.applyOps([{ type: 'item.react', clientOpId: 'r1', id: 'i1', emoji: '👍' }], {
        record: false,
      });

      expect(store.canUndo).toBe(false);
    });
  });

  describe('undo/redo (12.10)', () => {
    it('undo item.create удаляет элемент, redo восстанавливает', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      socket.next = { revision: 2 };
      await store.applyOps([{ type: 'item.create', clientOpId: 'c1', item: item() }]);
      expect(store.items.map((i) => i.id)).toEqual(['i1']);
      expect(store.canUndo).toBe(true);

      socket.next = { revision: 3 };
      await store.undo();
      expect(store.items).toHaveLength(0);
      expect(store.canUndo).toBe(false);
      expect(store.canRedo).toBe(true);

      socket.next = { revision: 4 };
      await store.redo();
      expect(store.items.map((i) => i.id)).toEqual(['i1']);
      expect(store.canRedo).toBe(false);
    });

    it('undo item.patch восстанавливает только тронутые поля', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item({ x: 0, style: { color: '#FCEB96', fontSize: 24 } })]);
      await store.join('board1');

      socket.next = { revision: 2 };
      await store.applyOps([
        {
          type: 'item.patch',
          clientOpId: 'a',
          id: 'i1',
          patch: { x: 50, style: { color: '#A8CAFF' } },
        },
      ]);
      expect(store.items[0]).toMatchObject({ x: 50, style: { color: '#A8CAFF', fontSize: 24 } });

      socket.next = { revision: 3 };
      await store.undo();
      expect(store.items[0]).toMatchObject({ x: 0, style: { color: '#FCEB96', fontSize: 24 } });
    });

    it('undo item.delete восстанавливает элемент вместе с каскадно удалённой связью', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item(), item({ id: 'i2' })], [edge()]);
      await store.join('board1');

      socket.next = { revision: 2 };
      await store.applyOps([{ type: 'item.delete', clientOpId: 'c1', id: 'i1' }]);
      expect(store.items.map((i) => i.id)).toEqual(['i2']);
      expect(store.edges).toHaveLength(0);

      socket.next = { revision: 3 };
      await store.undo();
      expect(store.items.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
      expect(store.edges.map((e) => e.id)).toEqual(['e1']);
    });

    it('новая операция после undo сбрасывает стек redo', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item()]);
      await store.join('board1');

      socket.next = { revision: 2 };
      await store.applyOps([{ type: 'item.patch', clientOpId: 'a', id: 'i1', patch: { x: 5 } }]);
      socket.next = { revision: 3 };
      await store.undo();
      expect(store.canRedo).toBe(true);

      socket.next = { revision: 4 };
      await store.applyOps([{ type: 'item.patch', clientOpId: 'b', id: 'i1', patch: { x: 9 } }]);
      expect(store.canRedo).toBe(false);
    });

    it('undo/redo без истории — no-op, без ошибок', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      await expect(store.undo()).resolves.toBeUndefined();
      await expect(store.redo()).resolves.toBeUndefined();
    });

    it('групповая правка мультивыбора отменяется одним undo целиком', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item({ id: 'i1', x: 0 }), item({ id: 'i2', x: 0 })]);
      await store.join('board1');

      socket.next = { revision: 2 };
      await store.applyOps([
        { type: 'item.patch', clientOpId: 'a', id: 'i1', patch: { x: 100 } },
        { type: 'item.patch', clientOpId: 'b', id: 'i2', patch: { x: 100 } },
      ]);
      expect(store.items.map((i) => i.x)).toEqual([100, 100]);

      socket.next = { revision: 3 };
      await store.undo();
      expect(store.items.map((i) => i.x)).toEqual([0, 0]);
    });

    it('отбрасывает операцию, чья цель удалена другим участником, не ломая undo', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1, [item({ x: 0 })]);
      await store.join('board1');

      socket.next = { revision: 2 };
      await store.applyOps([{ type: 'item.patch', clientOpId: 'a', id: 'i1', patch: { x: 50 } }]);
      expect(store.canUndo).toBe(true);

      // Другой участник удалил тот же элемент между правкой и попыткой её отменить
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.OPS, {
        revision: 3,
        ops: [{ type: 'item.delete', clientOpId: 'someone-else', id: 'i1' }],
      } satisfies BoardOpsBatch);
      expect(store.items).toHaveLength(0);

      await store.undo();
      // Инверс-патч на уже несуществующий элемент отброшен — запись просто исчезает,
      // ничего не отправлено на сервер и стек redo не пополняется
      expect(store.items).toHaveLength(0);
      expect(store.canUndo).toBe(false);
      expect(store.canRedo).toBe(false);
    });

    it('стек истории сбрасывается при выходе с доски', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      socket.next = { revision: 2 };
      await store.applyOps([{ type: 'item.create', clientOpId: 'c1', item: item() }]);
      expect(store.canUndo).toBe(true);

      store.leave();

      expect(store.canUndo).toBe(false);
      expect(store.canRedo).toBe(false);
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

    const entries: BoardPresenceEntry[] = [
      { participantId: 'p1', userId: 'u1', name: 'Иван', avatarUrl: null, isGuest: false },
    ];
    socket.emitLocal(BOARD_WS_SERVER_EVENTS.PRESENCE, entries);

    expect(store.presence).toEqual(entries);
  });

  it('принимает и хранит эфемерные курсоры участников по participantId', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(1);
    await store.join('board1');

    // Два разных участника пришли с курсором
    socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
      participantId: 'p1',
      userId: 'u1',
      name: 'Иван',
      avatarUrl: null,
      isGuest: false,
      kind: 'cursor',
      data: { x: 100, y: 200 },
    });
    socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
      participantId: 'p2',
      userId: 'u2',
      name: 'Мария',
      avatarUrl: 'https://example.com/avatar.png',
      isGuest: false,
      kind: 'cursor',
      data: { x: 50, y: 75 },
    });

    expect(store.awareness).toHaveLength(2);
    const byId = new Map(store.awareness.map((a) => [a.participantId, a]));
    expect(byId.get('p1')?.data).toEqual({ x: 100, y: 200 });
    expect(byId.get('p2')?.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('перезаписывает состояние курсора того же участника (LWW по participantId)', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(1);
    await store.join('board1');

    socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
      participantId: 'p1',
      userId: 'u1',
      name: 'Иван',
      avatarUrl: null,
      isGuest: false,
      kind: 'cursor',
      data: { x: 10, y: 20 },
    });
    socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
      participantId: 'p1',
      userId: 'u1',
      name: 'Иван',
      avatarUrl: null,
      isGuest: false,
      kind: 'cursor',
      data: { x: 30, y: 40 },
    });

    // Один участник — один курсор, последняя позиция
    expect(store.awareness).toHaveLength(1);
    expect(store.awareness[0]?.data).toEqual({ x: 30, y: 40 });
  });

  it('отправка собственного курсора шлёт awareness с canvas-координатами', async () => {
    const session = useSessionStore();
    session.setUser({
      id: 'me',
      provider: 'google',
      email: 'me@example.com',
      name: 'Я',
      jobTitle: null,
      avatarUrl: null,
    });
    const store = useBoardSessionStore();
    socket.next = snapshotResult(1);
    await store.join('board1');

    store.sendAwareness('cursor', { x: 42, y: 84 });

    expect(socket.sent.at(-1)).toMatchObject({
      event: BOARD_WS_EVENTS.AWARENESS,
      payload: { kind: 'cursor', data: { x: 42, y: 84 } },
    });
  });

  describe('мягкая блокировка редактирования (14.2)', () => {
    it('kind=editing active=true кладёт запись в editingByItem, не трогая awarenessByParticipant', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
        participantId: 'p1',
        userId: 'u1',
        name: 'Иван',
        avatarUrl: null,
        isGuest: false,
        kind: 'editing',
        data: { itemId: 'item-1', active: true },
      });

      expect(store.editingByItem.get('item-1')).toMatchObject({
        participantId: 'p1',
        name: 'Иван',
      });
      // editing-запись не должна попасть в курсорную карту awareness
      expect(store.awareness).toHaveLength(0);
    });

    it('active=false от того же participantId убирает блокировку; от другого — не убирает', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      // P1 начал редактировать элемент
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
        participantId: 'p1',
        userId: 'u1',
        name: 'Иван',
        avatarUrl: null,
        isGuest: false,
        kind: 'editing',
        data: { itemId: 'item-1', active: true },
      });
      expect(store.editingByItem.get('item-1')).toBeDefined();

      // P2 пытается снять чужую блокировку — запись должна остаться
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
        participantId: 'p2',
        userId: 'u2',
        name: 'Мария',
        avatarUrl: null,
        isGuest: false,
        kind: 'editing',
        data: { itemId: 'item-1', active: false },
      });
      expect(store.editingByItem.get('item-1')).toMatchObject({ participantId: 'p1' });

      // P1 снимает свою блокировку — запись исчезает
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
        participantId: 'p1',
        userId: 'u1',
        name: 'Иван',
        avatarUrl: null,
        isGuest: false,
        kind: 'editing',
        data: { itemId: 'item-1', active: false },
      });
      expect(store.editingByItem.get('item-1')).toBeUndefined();
    });

    it('выход участника из presence чистит его записи из editingByItem (анти-призрак)', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      // P1 начал редактировать, P2 — курсор
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
        participantId: 'p1',
        userId: 'u1',
        name: 'Иван',
        avatarUrl: null,
        isGuest: false,
        kind: 'editing',
        data: { itemId: 'item-1', active: true },
      });
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
        participantId: 'p2',
        userId: 'u2',
        name: 'Мария',
        avatarUrl: null,
        isGuest: false,
        kind: 'cursor',
        data: { x: 10, y: 20 },
      });

      // P1 и P2 оба вышли с доски — presence стал пустым списком
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.PRESENCE, []);

      expect(store.editingByItem.get('item-1')).toBeUndefined();
      expect(store.awareness).toHaveLength(0);
    });

    it('leave() чистит editingByItem', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
        participantId: 'p1',
        userId: 'u1',
        name: 'Иван',
        avatarUrl: null,
        isGuest: false,
        kind: 'editing',
        data: { itemId: 'item-1', active: true },
      });
      expect(store.editingByItem.get('item-1')).toBeDefined();

      store.leave();

      expect(store.editingByItem.get('item-1')).toBeUndefined();
    });
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

  it('при disconnect по причине io server disconnect переподключается и входит заново', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(2);
    await store.join('board1');
    socket.sent.length = 0;
    expect(store.connected).toBe(true);

    // Socket.io сам не переподключается при 'io server disconnect' — наш
    // хендшер (17.3) должен вызвать connect() вручную, и после connect
    // выполнить повторный вход с sinceRevision
    socket.disconnect('io server disconnect');

    socket.next = snapshotResult(2);
    socket.connect();
    await Promise.resolve();

    // Повторный JOIN с sinceRevision — как и при обычном переподключении
    expect(socket.sent[0]).toMatchObject({
      event: BOARD_WS_EVENTS.JOIN,
      payload: { boardId: 'board1', sinceRevision: 2 },
    });
    expect(store.joined).toBe(true);
    expect(store.connected).toBe(true);
  });

  it('при обычном disconnect (не server) НЕ переподключается сам', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(2);
    await store.join('board1');
    socket.sent.length = 0;

    // Обычный disconnect (сеть/таймаут) — Socket.io сам переподключится, но
    // в FakeSocket это не имитировано: connected остаётся false и JOIN не
    // отправляется до ручного connect()
    socket.disconnect('io client disconnect');
    expect(store.connected).toBe(false);
    expect(socket.sent).toHaveLength(0);
  });

  it('при переходе на другую доску сбрасывает прошлое состояние', async () => {
    const store = useBoardSessionStore();
    socket.next = snapshotResult(2, [item()]);
    await store.join('board1');

    socket.next = snapshotResult(1, [item({ id: 'i2', boardId: 'board2' })]);
    await store.join('board2');

    expect(store.items.map((i) => i.id)).toEqual(['i2']);
  });

  describe('Follow-mode камеры участника (14.5)', () => {
    /** Вспомогательник: broadcast awareness от другого участника */
    function broadcast(
      participantId: string,
      kind: BoardAwarenessBroadcast['kind'],
      data: Record<string, unknown>,
      userId: string | null = null,
      name = 'Участник',
    ): void {
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.AWARENESS, {
        participantId,
        userId,
        name,
        avatarUrl: null,
        isGuest: userId === null,
        kind,
        data,
      });
    }

    it('камера участника хранится отдельно от курсора — throttled cursor не затирает camera-запись того же participantId', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      // Сначала пришла камера P1
      broadcast('p1', 'camera', { x: 100, y: 200, zoom: 1.5 });
      // Потом throttled cursor того же P1
      broadcast('p1', 'cursor', { x: 50, y: 50 });

      // Камера живёт в своей карте, курсор — в awareness
      expect(store.cameraByParticipant.get('p1')).toEqual({ x: 100, y: 200, zoom: 1.5 });
      expect(store.awareness).toHaveLength(1);
      expect(store.awareness[0]?.data).toEqual({ x: 50, y: 50 });
    });

    it('followParticipant/stopFollowing переключают followedParticipantId и cameraOfFollowed', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      broadcast('p1', 'camera', { x: 300, y: 400, zoom: 0.8 });

      expect(store.followedParticipantId).toBe(null);
      expect(store.cameraOfFollowed).toBe(null);

      store.followParticipant('p1');
      expect(store.followedParticipantId).toBe('p1');
      expect(store.cameraOfFollowed).toEqual({ x: 300, y: 400, zoom: 0.8 });

      store.stopFollowing();
      expect(store.followedParticipantId).toBe(null);
      expect(store.cameraOfFollowed).toBe(null);
    });

    it('cameraOfFollowed игнорирует camera-апдейты от НЕ отслеживаемого участника', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      broadcast('p1', 'camera', { x: 10, y: 20, zoom: 1 });
      broadcast('p2', 'camera', { x: 200, y: 300, zoom: 2 });

      store.followParticipant('p1');
      // Следуем за P1 — его камера попала в cameraOfFollowed
      expect(store.cameraOfFollowed).toEqual({ x: 10, y: 20, zoom: 1 });

      // P2 тоже транслирует камеру — не должна заменить P1 в cameraOfFollowed
      expect(store.cameraByParticipant.get('p2')).toEqual({ x: 200, y: 300, zoom: 2 });
      expect(store.cameraOfFollowed).toEqual({ x: 10, y: 20, zoom: 1 });
    });

    it('уход отслеживаемого участника (presence без него) автоматически сбрасывает followedParticipantId', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      broadcast('p1', 'camera', { x: 100, y: 200, zoom: 1 });
      store.followParticipant('p1');

      // P1 ушёл — presence без него
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.PRESENCE, []);
      expect(store.followedParticipantId).toBe(null);
      expect(store.cameraOfFollowed).toBe(null);
    });

    it('смена доски / leave() сбрасывают followedParticipantId и очищают cameraByParticipant', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      broadcast('p1', 'camera', { x: 100, y: 200, zoom: 1 });
      store.followParticipant('p1');
      expect(store.cameraByParticipant.size).toBe(1);
      expect(store.followedParticipantId).toBe('p1');

      // Смена доски на живом сокете
      socket.next = snapshotResult(1);
      await store.join('board2');
      expect(store.followedParticipantId).toBe(null);
      expect(store.cameraByParticipant.size).toBe(0);

      // И после leave() — тоже
      store.leave();
      expect(store.followedParticipantId).toBe(null);
      expect(store.cameraByParticipant.size).toBe(0);
    });

    it('регрессия 14.4: два участника с userId===null (гости) не схлопывают awareness/presence друг друга — различаются по participantId', async () => {
      const store = useBoardSessionStore();
      socket.next = snapshotResult(1);
      await store.join('board1');

      // Два гостя с userId === null, но разными participantId
      broadcast('guest-a', 'cursor', { x: 10, y: 20 }, null, 'Гость А');
      broadcast('guest-b', 'cursor', { x: 30, y: 40 }, null, 'Гость Б');

      // Оба курсора должны быть на экране — не схлопнулись в одну запись
      expect(store.awareness).toHaveLength(2);

      // PRESENCE тоже различает их по participantId, а не userId
      const entries: BoardPresenceEntry[] = [
        { participantId: 'guest-a', userId: null, name: 'Гость А', avatarUrl: null, isGuest: true },
        { participantId: 'guest-b', userId: null, name: 'Гость Б', avatarUrl: null, isGuest: true },
      ];
      socket.emitLocal(BOARD_WS_SERVER_EVENTS.PRESENCE, entries);
      expect(store.presence).toHaveLength(2);
      const byPid = new Map(store.presence.map((p) => [p.participantId, p]));
      expect(byPid.get('guest-a')?.name).toBe('Гость А');
      expect(byPid.get('guest-b')?.name).toBe('Гость Б');
    });
  });
});
