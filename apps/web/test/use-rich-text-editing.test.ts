import type { Board, BoardItem, BoardStickyContent, JoinBoardResult } from '@estimate/shared';
import { BOARD_ITEM_TEXT_MAX_LENGTH, BOARD_WS_EVENTS } from '@estimate/shared';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, provide, ref, shallowRef } from 'vue';

import { createAppI18n } from '../src/i18n';
import { useBoardSessionStore } from '../src/stores/board-session';
import { useSessionStore } from '../src/stores/session';
import { useRichTextEditing } from '../src/features/boards/composables/use-rich-text-editing';
import {
  BOARD_ACTIVE_TEXT_EDITOR_KEY,
  BOARD_PENDING_EDIT_ID_KEY,
} from '../src/features/boards/context/board-canvas-keys';
import type { BoardTextEditorHandle } from '../src/features/boards/rich-text/board-rich-text';
import { serializeRuns, selectRange } from '../src/features/boards/rich-text/board-rich-text';

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

/** Две ноды под одним canvas-provider — воспроизводит два dblclick в одном тике. */
function mountTwoEditors() {
  // eslint-disable-next-line vue/one-component-per-file -- локальный тестовый child
  const Editor = defineComponent({
    props: { itemId: { type: String, required: true } },
    setup(props) {
      const result = useRichTextEditing({
        itemId: props.itemId,
        canEdit: ref(true),
        isSelected: ref(true),
        content: ref<BoardStickyContent>({ type: 'sticky', text: '' }),
        buildContent: (text, runs) => ({ type: 'sticky', text, ...(runs ? { runs } : {}) }),
      });
      return result;
    },
    template: '<div v-if="editing" ref="editable" contenteditable="true"></div>',
  });
  // eslint-disable-next-line vue/one-component-per-file -- локальный test host/provider
  const TestWrapper = defineComponent({
    components: { Editor },
    setup() {
      provide(BOARD_ACTIVE_TEXT_EDITOR_KEY, shallowRef(null));
    },
    template: '<Editor item-id="item-1" /><Editor item-id="item-2" />',
  });
  return { wrapper: mount(TestWrapper, { global: { plugins: [createAppI18n('ru')] } }), Editor };
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
    lock: { participantId: string; name: string } | null,
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
    await joinWithLock({ participantId: 'u2', name: 'Мария' });
    const wrapper = mountEditor();

    // lockedBy вычислен реактивно из editingByItem
    expect(wrapper.vm.lockedBy).toMatchObject({ participantId: 'u2', name: 'Мария' });

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

  it('startEditing() срывает follow-mode — вмешательство в работу другого участника', async () => {
    const boardSession = await joinWithLock(null);
    // Симулируем активный follow-mode за другим участником
    boardSession.followedParticipantId = 'other-participant';

    const wrapper = mountEditor();
    expect(wrapper.vm.editing).toBe(false);

    await wrapper.vm.startEditing();
    await nextTick();

    // follow-mode снят — editing прошёл
    expect(boardSession.followedParticipantId).toBe(null);
    expect(wrapper.vm.editing).toBe(true);

    wrapper.unmount();
  });

  it('два одновременных startEditing() оставляют активным только последний редактор', async () => {
    await joinWithLock(null);
    const { wrapper, Editor } = mountTwoEditors();
    const editors = wrapper.findAllComponents(Editor);
    const first = editors[0]!;
    const second = editors[1]!;

    await Promise.all([first.vm.startEditing(), second.vm.startEditing()]);
    await nextTick();

    expect(first.vm.editing).toBe(false);
    expect(second.vm.editing).toBe(true);
    expect(wrapper.findAll('[contenteditable="true"]')).toHaveLength(1);

    wrapper.unmount();
  });
});

describe('useRichTextEditing — форматирование без выделения (18.7)', () => {
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

  async function joinBoard() {
    const boardSession = useBoardSessionStore();
    socket.next = snapshotResult(1);
    await boardSession.join('board1');
    return boardSession;
  }

  /** Монтирует composable с предоставленным BOARD_ACTIVE_TEXT_EDITOR_KEY и возвращает ref на хэндл */
  function mountWithEditor(text: string) {
    const activeTextEditor = shallowRef<BoardTextEditorHandle | null>(null);
    const TestWrapper = defineComponent({
      setup() {
        const canEdit = ref(true);
        const isSelected = ref(true);
        const content = ref<BoardStickyContent>({ type: 'sticky', text });
        const result = useRichTextEditing({
          itemId: 'item-1',
          canEdit,
          isSelected,
          content,
          buildContent: (text, runs) =>
            ({ type: 'sticky', text, ...(runs ? { runs } : {}) }) as BoardStickyContent,
        });
        return result;
      },
      template: '<div><div ref="editable" contenteditable="true"></div></div>',
    });
    const wrapper = mount(TestWrapper, {
      global: {
        plugins: [createAppI18n('ru')],
        provide: {
          [BOARD_ACTIVE_TEXT_EDITOR_KEY]: activeTextEditor,
        } as Record<symbol, unknown>,
      },
    });
    return { wrapper, activeTextEditor };
  }

  /** Вход в редактирование + доступ к DOM-элементу */
  async function setupEditor(text: string) {
    await joinBoard();
    const { wrapper, activeTextEditor } = mountWithEditor(text);
    await wrapper.vm.startEditing();
    await nextTick();
    const el = wrapper.find('[contenteditable="true"]').element as HTMLElement;
    return { wrapper, activeTextEditor, el };
  }

  it('непустой текст, cursor без выделения → toggle("bold") форматирует весь текст', async () => {
    const { wrapper, activeTextEditor, el } = await setupEditor('Hello world');

    // Схлопываем selection в cursor (без выделения)
    selectRange(el, 5, 5);
    wrapper.vm.refreshActiveMarks();

    expect(activeTextEditor.value?.hasTextSelection.value).toBe(false);
    expect(activeTextEditor.value?.activeMarks.value).not.toBeNull();

    activeTextEditor.value?.toggle('bold');

    const runs = serializeRuns(el);
    expect(runs).toEqual([{ text: 'Hello world', marks: { bold: true } }]);

    wrapper.unmount();
  });

  it('непустой текст, cursor без выделения → setHighlight() форматирует весь текст', async () => {
    const { wrapper, activeTextEditor, el } = await setupEditor('Hello world');

    selectRange(el, 5, 5);
    wrapper.vm.refreshActiveMarks();

    expect(activeTextEditor.value?.hasTextSelection.value).toBe(false);

    activeTextEditor.value?.setHighlight('yellow');

    const runs = serializeRuns(el);
    expect(runs).toEqual([{ text: 'Hello world', marks: { highlight: 'yellow' } }]);

    wrapper.unmount();
  });

  it('при выделении части текста форматируется только эта часть', async () => {
    const { wrapper, activeTextEditor, el } = await setupEditor('Hello world');

    // Выделяем "Hello" (0..5). jsdom не поддерживает Selection.addRange на
    // contenteditable внутри Vue Test Utils — mock getSelection, чтобы
    // refreshActiveMarks увидел непустое выделение
    const textNode = el.childNodes[0]!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    const mockSelection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      removeAllRanges: () => {},
      addRange: () => {},
    };
    const spy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue(mockSelection as unknown as Selection);

    selectRange(el, 0, 5);
    wrapper.vm.refreshActiveMarks();

    expect(activeTextEditor.value?.hasTextSelection.value).toBe(true);

    activeTextEditor.value?.toggle('bold');

    spy.mockRestore();

    const runs = serializeRuns(el);
    expect(runs).toEqual([{ text: 'Hello', marks: { bold: true } }, { text: ' world' }]);

    wrapper.unmount();
  });

  it('пустой текст не получает форматирования', async () => {
    const { wrapper, activeTextEditor, el } = await setupEditor('');

    await nextTick();
    // При пустом тексте DOM пуст — симулируем курсор
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    wrapper.vm.refreshActiveMarks();

    expect(activeTextEditor.value?.hasTextSelection.value).toBe(false);
    expect(activeTextEditor.value?.activeMarks.value).toBeNull();

    activeTextEditor.value?.toggle('bold');

    const runs = serializeRuns(el);
    expect(runs).toEqual([]);

    wrapper.unmount();
  });

  it('ссылка при схлопнутом cursor не получает fallback-диапазон', async () => {
    const { wrapper, activeTextEditor, el } = await setupEditor('Hello world');

    // Схлопываем selection (cursor без выделения)
    selectRange(el, 5, 5);
    wrapper.vm.refreshActiveMarks();

    expect(activeTextEditor.value?.hasTextSelection.value).toBe(false);

    activeTextEditor.value?.setLink('https://example.com');

    // Ссылка не должна примениться — нет выделения
    const runs = serializeRuns(el);
    expect(runs).toEqual([{ text: 'Hello world' }]);

    wrapper.unmount();
  });
});

describe('useRichTextEditing — IME-композиция на границе лимита длины (12.24)', () => {
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

  it('insertCompositionText на границе лимита БЕЗ активной композиции блокируется как раньше', () => {
    const wrapper = mountEditor();
    const el = wrapper.find('[contenteditable="true"]').element as HTMLElement;
    el.textContent = 'x'.repeat(BOARD_ITEM_TEXT_MAX_LENGTH);

    const event = new InputEvent('beforeinput', {
      inputType: 'insertCompositionText',
      cancelable: true,
    });
    wrapper.vm.onEditableBeforeInput(event);

    expect(event.defaultPrevented).toBe(true);

    wrapper.unmount();
  });

  it('insertCompositionText на границе лимита ВО ВРЕМЯ активной композиции не блокируется (12.24)', () => {
    // Отмена beforeinput посреди IME-композиции — известная особенность
    // Chromium/WebKit, способная испортить UI самой композиции. Лимит
    // применяется постфактум, в onEditableCompositionEnd (тест ниже).
    const wrapper = mountEditor();
    const el = wrapper.find('[contenteditable="true"]').element as HTMLElement;
    el.textContent = 'x'.repeat(BOARD_ITEM_TEXT_MAX_LENGTH);

    wrapper.vm.onEditableCompositionStart();
    const event = new InputEvent('beforeinput', {
      inputType: 'insertCompositionText',
      cancelable: true,
    });
    wrapper.vm.onEditableBeforeInput(event);

    expect(event.defaultPrevented).toBe(false);

    wrapper.unmount();
  });

  it('onEditableCompositionEnd обрезает результат композиции до лимита постфактум', () => {
    const wrapper = mountEditor();
    const el = wrapper.find('[contenteditable="true"]').element as HTMLElement;
    el.textContent = 'x'.repeat(BOARD_ITEM_TEXT_MAX_LENGTH + 5);

    wrapper.vm.onEditableCompositionStart();
    wrapper.vm.onEditableCompositionEnd();

    expect(el.textContent).toBe('x'.repeat(BOARD_ITEM_TEXT_MAX_LENGTH));
    expect(wrapper.vm.liveText).toBe('x'.repeat(BOARD_ITEM_TEXT_MAX_LENGTH));

    wrapper.unmount();
  });

  it('onEditableCompositionEnd — не трогает текст в пределах лимита', () => {
    const wrapper = mountEditor();
    const el = wrapper.find('[contenteditable="true"]').element as HTMLElement;
    el.textContent = 'привет';

    wrapper.vm.onEditableCompositionStart();
    wrapper.vm.onEditableCompositionEnd();

    expect(el.textContent).toBe('привет');

    wrapper.unmount();
  });
});

describe('useRichTextEditing — drag&drop чужого текста в contenteditable (12.25)', () => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- тестовый мок нестандартного DOM API
    delete (document as any).caretRangeFromPoint;
  });

  function makeDropEvent(text: string): DragEvent {
    return {
      preventDefault: vi.fn(),
      clientX: 0,
      clientY: 0,
      dataTransfer: { getData: () => text },
    } as unknown as DragEvent;
  }

  /**
   * Мок недоступного в jsdom `document.caretRangeFromPoint` — точка дропа в
   * конце текста узла. Дополнительно мокает `window.getSelection()` — jsdom
   * внутри Vue Test Utils не поддерживает `Selection.addRange()` на
   * contenteditable по-настоящему (та же гоча, что уже задокументирована в
   * тестах 18.7 выше в этом файле), поэтому `insertPlainTextAtCaret` не нашёл
   * бы вставленный `range` без стаба, backed тем же объектом Range.
   */
  function mockCaretAtEnd(el: HTMLElement): void {
    const textNode = el.firstChild;
    const range = document.createRange();
    if (textNode) {
      range.setStart(textNode, textNode.textContent?.length ?? 0);
    } else {
      range.selectNodeContents(el);
    }
    range.collapse(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- нестандартный DOM API, вне lib.dom.d.ts
    (document as any).caretRangeFromPoint = vi.fn(() => range);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: range.collapsed,
      getRangeAt: () => range,
      removeAllRanges: () => {},
      addRange: () => {},
    } as unknown as Selection);
  }

  it('вставляет текст в точку дропа (не в текущее выделение) и вызывает preventDefault', () => {
    const wrapper = mountEditor();
    const el = wrapper.find('[contenteditable="true"]').element as HTMLElement;
    el.textContent = 'Hello';
    mockCaretAtEnd(el);

    const event = makeDropEvent(' world');
    wrapper.vm.onEditableDrop(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(el.textContent).toBe('Hello world');

    wrapper.unmount();
  });

  it('уважает лимит длины — обрезает вставляемый текст по бюджету, как и paste (12.13)', () => {
    const wrapper = mountEditor();
    const el = wrapper.find('[contenteditable="true"]').element as HTMLElement;
    el.textContent = 'x'.repeat(BOARD_ITEM_TEXT_MAX_LENGTH - 3);
    mockCaretAtEnd(el);

    wrapper.vm.onEditableDrop(makeDropEvent('abcdefghij'));

    expect(el.textContent).toBe('x'.repeat(BOARD_ITEM_TEXT_MAX_LENGTH - 3) + 'abc');
    expect((el.textContent ?? '').length).toBe(BOARD_ITEM_TEXT_MAX_LENGTH);

    wrapper.unmount();
  });

  it('точка дропа вне contenteditable — ничего не вставляется', () => {
    const wrapper = mountEditor();
    const el = wrapper.find('[contenteditable="true"]').element as HTMLElement;
    el.textContent = 'Hello';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- нестандартный DOM API
    (document as any).caretRangeFromPoint = vi.fn(() => {
      const range = document.createRange();
      range.selectNodeContents(document.body);
      range.collapse(true);
      return range;
    });

    wrapper.vm.onEditableDrop(makeDropEvent('injected'));

    expect(el.textContent).toBe('Hello');

    wrapper.unmount();
  });

  it('caretRangeFromPoint/caretPositionFromPoint недоступны в браузере — молча ничего не вставляет', () => {
    const wrapper = mountEditor();
    const el = wrapper.find('[contenteditable="true"]').element as HTMLElement;
    el.textContent = 'Hello';
    // jsdom по умолчанию не реализует ни один из двух API — не мокаем ничего

    wrapper.vm.onEditableDrop(makeDropEvent('injected'));

    expect(el.textContent).toBe('Hello');

    wrapper.unmount();
  });
});

describe('useRichTextEditing — автопереход по pendingEditId при mount (12.26)', () => {
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

  async function joinBoard() {
    const boardSession = useBoardSessionStore();
    socket.next = snapshotResult(1);
    await boardSession.join('board1');
    return boardSession;
  }

  /** Монтирует composable с предоставленным BOARD_PENDING_EDIT_ID_KEY и условным рендером editor-узла */
  function mountWithPendingEditId(pendingEditIdValue: string | null) {
    const activeTextEditor = shallowRef<BoardTextEditorHandle | null>(null);
    const pendingEditId = ref(pendingEditIdValue);
    // eslint-disable-next-line vue/one-component-per-file -- локальный test host для pendingEditId
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
          buildContent: (text, runs) =>
            ({ type: 'sticky', text, ...(runs ? { runs } : {}) }) as BoardStickyContent,
        });
        return result;
      },
      template: '<div><div v-if="editing" ref="editable" contenteditable="true"></div></div>',
    });
    const wrapper = mount(TestWrapper, {
      global: {
        plugins: [createAppI18n('ru')],
        provide: {
          [BOARD_ACTIVE_TEXT_EDITOR_KEY]: activeTextEditor,
          [BOARD_PENDING_EDIT_ID_KEY]: pendingEditId,
        } as Record<symbol, unknown>,
      },
    });
    return { wrapper, activeTextEditor, pendingEditId };
  }

  it('pendingEditId === itemId при mount автоматически открывает редактор — baseline не сломан', async () => {
    await joinBoard();
    const { wrapper, activeTextEditor } = mountWithPendingEditId('item-1');

    await nextTick();

    expect(wrapper.vm.editing).toBe(true);
    expect(wrapper.findAll('[contenteditable="true"]')).toHaveLength(1);
    expect(activeTextEditor.value).not.toBe(null);

    wrapper.unmount();
  });

  it('token очищен до mount — editor остаётся с editing === false, contenteditable не появляется, awareness editing: true не отправляется', async () => {
    await joinBoard();
    const { wrapper, pendingEditId } = mountWithPendingEditId(null);

    await nextTick();

    expect(pendingEditId.value).toBe(null);
    expect(wrapper.vm.editing).toBe(false);
    expect(wrapper.findAll('[contenteditable="true"]')).toHaveLength(0);
    // awareness editing: true не отправляется — onMounted не вызвал startEditing()
    expect(socket.sent).not.toContainEqual(
      expect.objectContaining({
        event: BOARD_WS_EVENTS.AWARENESS,
        payload: { kind: 'editing', data: { itemId: 'item-1', active: true } },
      }),
    );

    wrapper.unmount();
  });
});
