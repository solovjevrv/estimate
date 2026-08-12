import type { Board, BoardItem, BoardStickyContent, JoinBoardResult } from '@poker/shared';
import { BOARD_WS_EVENTS } from '@poker/shared';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

import { createAppI18n } from '../src/i18n';
import { useBoardSessionStore } from '../src/stores/board-session';
import { useSessionStore } from '../src/stores/session';
import { useRichTextEditing } from '../src/lib/board/use-rich-text-editing';

/* --- Hoisted mocks (vi.mock runs above imports — переменные через vi.hoisted) --- */
const { toastAdd, socket } = vi.hoisted(() => {
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

    disconnect(): void {
      this.connected = false;
      this.emitLocal('disconnect', 'io client disconnect');
    }

    /** Очистка состояния между тестами (аналог board-session.test.ts) */
    reset(): void {
      this.sent.length = 0;
      this.listeners.clear();
      this.next = null;
      this.nextError = null;
      this.connected = false;
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

  const instance = new FakeSocket();
  return { toastAdd: vi.fn(), socket: instance };
});

vi.mock('@nuxt/ui/composables', () => ({
  useToast: () => ({ add: toastAdd, remove: vi.fn() }),
}));

vi.mock('../src/lib/socket', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/socket')>('../src/lib/socket');
  return { ...actual, createSocket: () => socket };
});

function snapshotResult(revision: number, items: BoardItem[] = []): JoinBoardResult {
  return {
    revision,
    snapshot: { board: { shareRole: null } as Board, items, edges: [], access: 'manage' },
    catchup: null,
    access: 'manage',
    participantId: 'actor1',
    guestToken: null,
  };
}

/** Монтирует тестовый компонент с composable */
function mountEditor() {
  const TestWrapper = defineComponent({
    setup() {
      const canEdit = ref(true);
      const isSelected = ref(true);
      const content = ref<BoardStickyContent>({ type: 'sticky', text: '' });
      const result = useRichTextEditing({
        itemId: 'item-1',
        canEdit,
        isSelected,
        content,
        buildContent: (text, runs) => ({ type: 'sticky', text, ...(runs ? { runs } : {}) }),
      });
      return { canEdit, isSelected, ...result };
    },
    template: '<div><div ref="editable" contenteditable="true"></div></div>',
  });
  return mount(TestWrapper, {
    global: { plugins: [createAppI18n('ru')] },
  });
}

describe('useRichTextEditing — мягкая блокировка (14.2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    socket.reset();
    toastAdd.mockClear();

    const session = useSessionStore();
    session.setUser({
      id: 'me',
      provider: 'google',
      email: 'me@example.com',
      name: 'Я',
      jobTitle: null,
      avatarUrl: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Вход на доску + (опциональная) установка блокировки на item-1 */
  async function joinWithLock(
    lock: { userId: string; name: string } | null,
  ): Promise<ReturnType<typeof useBoardSessionStore>> {
    const boardSession = useBoardSessionStore();
    socket.next = snapshotResult(1);
    await boardSession.join('board1');
    if (lock) {
      boardSession.editingByItem.set('item-1', lock);
    }
    return boardSession;
  }

  it('startEditing() блокируется если lockedBy — editing остаётся false, показывается тост', async () => {
    await joinWithLock({ userId: 'u2', name: 'Мария' });
    const wrapper = mountEditor();

    // lockedBy вычислен реактивно из editingByItem
    expect(wrapper.vm.lockedBy).toMatchObject({ userId: 'u2', name: 'Мария' });

    await wrapper.vm.startEditing();

    expect(wrapper.vm.editing).toBe(false);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'warning' }));
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Мария сейчас редактирует этот элемент' }),
    );

    wrapper.unmount();
  });

  it('watch(editing) шлёт awareness active=true при startEditing и active=false при cancelEditing', async () => {
    await joinWithLock(null); // без блокировки — можно редактировать
    const wrapper = mountEditor();

    expect(wrapper.vm.lockedBy).toBeNull();

    const awarenessBefore = socket.sent.filter((s) => s.event === BOARD_WS_EVENTS.AWARENESS).length;

    await wrapper.vm.startEditing();
    await nextTick();

    const newAwareness = socket.sent
      .filter((s) => s.event === BOARD_WS_EVENTS.AWARENESS)
      .slice(awarenessBefore);
    expect(newAwareness).toContainEqual(
      expect.objectContaining({
        event: BOARD_WS_EVENTS.AWARENESS,
        payload: { kind: 'editing', data: { itemId: 'item-1', active: true } },
      }),
    );

    wrapper.vm.cancelEditing();
    await nextTick();

    expect(socket.sent).toContainEqual(
      expect.objectContaining({
        event: BOARD_WS_EVENTS.AWARENESS,
        payload: { kind: 'editing', data: { itemId: 'item-1', active: false } },
      }),
    );

    expect(wrapper.vm.editing).toBe(false);

    wrapper.unmount();
  });

  it('watch(editing) шлёт awareness при commitEditing (через watch isSelected)', async () => {
    await joinWithLock(null);
    const wrapper = mountEditor();

    await wrapper.vm.startEditing();
    await nextTick();

    const awarenessBefore = socket.sent.filter((s) => s.event === BOARD_WS_EVENTS.AWARENESS).length;

    // Снимаем выделение — watch(isSelected) вызывает commitEditing()
    wrapper.vm.isSelected = false;
    await nextTick();

    const newAwareness = socket.sent
      .filter((s) => s.event === BOARD_WS_EVENTS.AWARENESS)
      .slice(awarenessBefore);
    expect(newAwareness).toContainEqual(
      expect.objectContaining({
        event: BOARD_WS_EVENTS.AWARENESS,
        payload: { kind: 'editing', data: { itemId: 'item-1', active: false } },
      }),
    );

    wrapper.unmount();
  });
});
