import type { BoardItem, BoardOp, ReactionEmoji } from '@poker/shared';
import { BOARD_MAX_ITEMS } from '@poker/shared';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMOJI_DEFAULT_HEIGHT,
  EMOJI_DEFAULT_WIDTH,
  fitImageToDefaultBox,
  SHAPE_DEFAULT_HEIGHT,
  SHAPE_DEFAULT_WIDTH,
  STICKER_DEFAULT_HEIGHT,
  STICKER_DEFAULT_WIDTH,
  STICKY_DEFAULT_COLOR,
  STICKY_DEFAULT_HEIGHT,
  STICKY_DEFAULT_WIDTH,
  TEXT_DEFAULT_HEIGHT,
  TEXT_DEFAULT_WIDTH,
} from '../src/features/boards/config/board-item-defaults';
import {
  FRAME_DEFAULT_HEIGHT,
  FRAME_DEFAULT_WIDTH,
} from '../src/features/boards/config/board-constants';
import { useBoardCreation } from '../src/features/boards/composables/use-board-creation';
import type { UseBoardCreationOptions } from '../src/features/boards/composables/use-board-creation';

/* --- Hoisted mocks for useToast, useI18n, uploadBoardAsset and uuid --- */
const toastAdd = vi.hoisted(() => vi.fn(() => ({ id: 'toast-1' })));
const toastRemove = vi.hoisted(() => vi.fn());
const tFn = vi.hoisted(() => vi.fn((key: string) => key));
const uploadBoardAsset = vi.hoisted(() => vi.fn());
const __uuidState = vi.hoisted(() => ({ counter: 0 }));
const uuidMock = vi.hoisted(() => vi.fn(() => `test-uuid-${__uuidState.counter++}`));

vi.mock('@nuxt/ui/composables', () => ({
  useToast: () => ({ add: toastAdd, remove: toastRemove }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: tFn }),
}));

vi.mock('../src/features/boards/api/boards-api', () => ({
  uploadBoardAsset,
}));

vi.mock('../src/features/boards/infrastructure/uuid', () => ({
  uuid: uuidMock,
}));

function makeItem(id: string, overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    id,
    boardId: 'board-1',
    parentId: null,
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    rotation: 0,
    zIndex: 0,
    content: { type: 'sticky', text: id },
    style: { color: STICKY_DEFAULT_COLOR },
    reactions: [],
    createdBy: 'user-1',
    updatedAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeOptions(overrides: Partial<UseBoardCreationOptions> = {}): UseBoardCreationOptions & {
  applyOps: ReturnType<typeof vi.fn>;
} {
  const applyOps = vi.fn<(ops: BoardOp[]) => void>();
  const breakFollowOnEdit = vi.fn();
  const items: BoardItem[] = [];
  return {
    boardId: () => 'board-1',
    canEdit: () => true,
    getItems: () => items,
    getCanvasRect: () => ({ width: 400, height: 300, left: 0, top: 0 }) as DOMRect,
    project: (point) => point,
    findContainerAt: () => undefined,
    applyOps,
    breakFollowOnEdit,
    ...overrides,
  } as UseBoardCreationOptions & { applyOps: Mock; breakFollowOnEdit: Mock };
}

const EMOJI = '👍' as ReactionEmoji;

describe('useBoardCreation', () => {
  beforeEach(() => {
    __uuidState.counter = 0;
    toastAdd.mockClear();
    toastRemove.mockClear();
    tFn.mockClear();
    uploadBoardAsset.mockReset();
  });

  describe('createSticky', () => {
    it('создаёт один item.create, центрирует вокруг точки, использует frame и задаёт pendingEditId', () => {
      const frame = makeItem('frame', { content: { type: 'frame', title: 'Frame' } });
      const items = [frame];
      const options = makeOptions({
        getItems: () => items,
        findContainerAt: (point) => (point.x === 100 && point.y === 50 ? frame : undefined),
      });
      const api = useBoardCreation(options);

      api.createSticky({ x: 100, y: 50 });

      const ops = options.applyOps.mock.calls[0]?.[0] ?? [];
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ type: 'item.create' });
      const item = ops[0]!.item;
      expect(item.id).toBe('test-uuid-0');
      expect(item.parentId).toBe('frame');
      expect(item.x).toBe(100 - STICKY_DEFAULT_WIDTH / 2);
      expect(item.y).toBe(50 - STICKY_DEFAULT_HEIGHT / 2);
      expect(item.width).toBe(STICKY_DEFAULT_WIDTH);
      expect(item.height).toBe(STICKY_DEFAULT_HEIGHT);
      expect(item.rotation).toBe(0);
      expect(item.reactions).toEqual([]);
      expect(item.content).toEqual({ type: 'sticky', text: '' });
      expect(item.style).toEqual({ color: STICKY_DEFAULT_COLOR });
      expect(api.pendingEditId.value).toBe('test-uuid-0');
    });
  });

  describe('лимит элементов', () => {
    it('canCreateItem() возвращает false при BOARD_MAX_ITEMS, не вызывает applyOps и показывает toast', () => {
      const items: BoardItem[] = [];
      for (let i = 0; i < BOARD_MAX_ITEMS; i++) {
        items.push(makeItem(`item-${i}`));
      }
      const options = makeOptions({ getItems: () => items });
      const api = useBoardCreation(options);

      expect(api.canCreateItem()).toBe(false);
      expect(options.applyOps).not.toHaveBeenCalled();
      expect(toastAdd).toHaveBeenCalledWith({ title: 'board.itemLimitReached', color: 'error' });
    });
  });

  describe('createFrame', () => {
    it('parentId null, zIndex = minZIndex - 1, правильные defaults', () => {
      const items = [makeItem('a', { zIndex: 5 }), makeItem('b', { zIndex: 3 })];
      const options = makeOptions({ getItems: () => items });
      const api = useBoardCreation(options);

      api.createFrame({ x: 200, y: 100 });

      const ops = options.applyOps.mock.calls[0]?.[0] ?? [];
      expect(ops).toHaveLength(1);
      const item = ops[0]!.item;
      expect(item.parentId).toBe(null);
      expect(item.zIndex).toBe(-1); // minZIndex([5,3]) starts at 0 → 0 - 1 = -1
      expect(item.x).toBe(200 - FRAME_DEFAULT_WIDTH / 2);
      expect(item.y).toBe(100 - FRAME_DEFAULT_HEIGHT / 2);
      expect(item.width).toBe(FRAME_DEFAULT_WIDTH);
      expect(item.height).toBe(FRAME_DEFAULT_HEIGHT);
      expect(item.content).toEqual({ type: 'frame', title: '' });
      expect(item.rotation).toBe(0);
      expect(item.reactions).toEqual([]);
    });
  });

  describe('createImage (успешный)', () => {
    it('upload получает File, item использует fit-размеры рамки, content хранит исходные размеры, parent по центру', async () => {
      const frame = makeItem('frame', { content: { type: 'frame', title: 'Frame' } });
      const items = [frame];
      const options = makeOptions({
        getItems: () => items,
        findContainerAt: (point) => (point.x === 150 && point.y === 75 ? frame : undefined),
      });
      const api = useBoardCreation(options);

      const file = new File(['fake'], 'test.png', { type: 'image/png' });
      uploadBoardAsset.mockResolvedValue({
        ok: true,
        asset: { url: 'https://img/test', width: 2000, height: 1000 },
      });

      await api.createImage({ x: 150, y: 75 }, file);

      expect(uploadBoardAsset).toHaveBeenCalledWith('board-1', file);
      const ops = options.applyOps.mock.calls[0]?.[0] ?? [];
      expect(ops).toHaveLength(1);
      const item = ops[0]!.item;
      const fitted = fitImageToDefaultBox(2000, 1000);
      expect(item.parentId).toBe('frame');
      expect(item.width).toBe(fitted.width);
      expect(item.height).toBe(fitted.height);
      expect(item.x).toBe(150 - fitted.width / 2);
      expect(item.y).toBe(75 - fitted.height / 2);
      expect(item.content).toEqual({
        type: 'image',
        url: 'https://img/test',
        width: 2000,
        height: 1000,
      });
      expect(api.pendingEditId.value).toBe('test-uuid-0');
    });

    it('не отправляет ops при неудаче загрузки и не стирает pendingEditId более поздней конкурентной загрузки', async () => {
      const options = makeOptions();
      const api = useBoardCreation(options);

      const file = new File(['fake'], 'test.png', { type: 'image/png' });
      // Первая загрузка — ошибка, вторая — успех
      uploadBoardAsset
        .mockResolvedValueOnce({ ok: false, reason: 'failed' })
        .mockResolvedValueOnce({ ok: true, asset: { url: 'u2', width: 100, height: 100 } });

      // Запускаем обе загрузки почти одновременно
      const p1 = api.createImage({ x: 0, y: 0 }, file);
      const p2 = api.createImage({ x: 10, y: 10 }, file);

      await Promise.all([p1, p2]);

      // Первая загрузка провалилась → не должна стирать pendingEditId (уже перезаписан второй)
      // Вторая загрузка успешна → ops отправлены
      expect(options.applyOps).toHaveBeenCalledTimes(1);
      expect(api.pendingEditId.value).not.toBe(null);
      expect(toastAdd).toHaveBeenCalledWith({ title: 'board.imageUploadFailed', color: 'error' });
    });
  });

  describe('onPaneClick', () => {
    it('armed tool создаёт элемент и сбрасывается в select', () => {
      const options = makeOptions();
      const api = useBoardCreation(options);

      api.activeTool.value = 'sticky';
      api.onPaneClick(new MouseEvent('click', { clientX: 100, clientY: 50 }));

      expect(options.applyOps).toHaveBeenCalledTimes(1);
      expect(api.activeTool.value).toBe('select');
    });

    it('select и arrow не вызывают breakFollowOnEdit', () => {
      const options = makeOptions();
      const api = useBoardCreation(options);

      api.activeTool.value = 'select';
      api.onPaneClick(new MouseEvent('click', { clientX: 0, clientY: 0 }));
      expect(options.breakFollowOnEdit).not.toHaveBeenCalled();

      api.activeTool.value = 'arrow';
      api.onPaneClick(new MouseEvent('click', { clientX: 0, clientY: 0 }));
      expect(options.breakFollowOnEdit).not.toHaveBeenCalled();
    });
  });

  describe('onPaneDoubleClick', () => {
    it('создаёт sticky при клике по vue-flow__pane', () => {
      const options = makeOptions();
      const api = useBoardCreation(options);

      const event = new MouseEvent('dblclick', { clientX: 100, clientY: 50 });
      Object.defineProperty(event, 'target', {
        value: { classList: { contains: (cls: string) => cls === 'vue-flow__pane' } },
      });

      api.onPaneDoubleClick(event);

      expect(options.breakFollowOnEdit).toHaveBeenCalledOnce();
      expect(options.applyOps).toHaveBeenCalledTimes(1);
      expect(options.applyOps.mock.calls[0]![0][0]!).toMatchObject({ type: 'item.create' });
    });

    it('не создаёт элемент, если клик не по панe', () => {
      const options = makeOptions();
      const api = useBoardCreation(options);

      const event = new MouseEvent('dblclick', { clientX: 0, clientY: 0 });
      Object.defineProperty(event, 'target', {
        value: { classList: { contains: () => false } },
      });

      api.onPaneDoubleClick(event);

      expect(options.applyOps).not.toHaveBeenCalled();
    });
  });

  describe('onPaneDrop', () => {
    it('первый файл создаёт image', async () => {
      const options = makeOptions();
      const api = useBoardCreation(options);

      const file = new File(['data'], 'img.png', { type: 'image/png' });
      uploadBoardAsset.mockResolvedValue({
        ok: true,
        asset: { url: 'u', width: 100, height: 100 },
      });

      const event = new Event('drop', { cancelable: true }) as unknown as DragEvent;
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [file] },
        writable: true,
        configurable: true,
      });
      api.onPaneDrop(event);

      expect(options.breakFollowOnEdit).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);

      await new Promise((r) => setTimeout(r, 0));
      expect(options.applyOps).toHaveBeenCalledTimes(1);
    });

    it('read-only не вызывает preventDefault, breakFollowOnEdit и upload', () => {
      const event = new Event('drop') as unknown as DragEvent;
      const preventDefault = vi.fn();
      Object.defineProperty(event, 'preventDefault', { value: preventDefault, writable: true });

      const options = makeOptions({ canEdit: () => false });
      const api = useBoardCreation(options);

      api.onPaneDrop(event);

      expect(preventDefault).not.toHaveBeenCalled();
      expect(options.breakFollowOnEdit).not.toHaveBeenCalled();
      expect(uploadBoardAsset).not.toHaveBeenCalled();
    });
  });

  describe('createEmojiAtCenter', () => {
    it('создаёт emoji в центре canvas', () => {
      const options = makeOptions();
      const api = useBoardCreation(options);

      api.createEmojiAtCenter(EMOJI);

      const ops = options.applyOps.mock.calls[0]?.[0] ?? [];
      expect(ops).toHaveLength(1);
      const item = ops[0]!.item;
      // Центр canvas 400x300, project = identity → center = (200, 150)
      expect(item.x).toBe(200 - EMOJI_DEFAULT_WIDTH / 2);
      expect(item.y).toBe(150 - EMOJI_DEFAULT_HEIGHT / 2);
      expect(item.width).toBe(EMOJI_DEFAULT_WIDTH);
      expect(item.height).toBe(EMOJI_DEFAULT_HEIGHT);
      expect(item.content).toEqual({ type: 'emoji', emoji: EMOJI });
      expect(item.rotation).toBe(0);
      // pendingEditId НЕ выставляется для emoji
      expect(api.pendingEditId.value).toBe(null);
    });
  });

  describe('createStickerAtCenter', () => {
    it('создаёт sticker в центре canvas', () => {
      const options = makeOptions();
      const api = useBoardCreation(options);

      api.createStickerAtCenter('pack-1', 'sticker-1');

      const ops = options.applyOps.mock.calls[0]?.[0] ?? [];
      expect(ops).toHaveLength(1);
      const item = ops[0]!.item;
      expect(item.x).toBe(200 - STICKER_DEFAULT_WIDTH / 2);
      expect(item.y).toBe(150 - STICKER_DEFAULT_HEIGHT / 2);
      expect(item.content).toEqual({ type: 'sticker', pack: 'pack-1', id: 'sticker-1' });
      // pendingEditId НЕ выставляется для sticker
      expect(api.pendingEditId.value).toBe(null);
    });
  });

  describe('createShape', () => {
    it('создаёт shape с правильными defaults и pendingEditId', () => {
      const options = makeOptions();
      const api = useBoardCreation(options);

      api.createShape({ x: 100, y: 50 });

      const ops = options.applyOps.mock.calls[0]?.[0] ?? [];
      const item = ops[0]!.item;
      expect(item.x).toBe(100 - SHAPE_DEFAULT_WIDTH / 2);
      expect(item.y).toBe(50 - SHAPE_DEFAULT_HEIGHT / 2);
      expect(item.content).toEqual({ type: 'shape', shape: 'rectangle', text: '' });
      expect(api.pendingEditId.value).toBe('test-uuid-0');
    });
  });

  describe('createText', () => {
    it('создаёт text с правильными defaults и pendingEditId', () => {
      const options = makeOptions();
      const api = useBoardCreation(options);

      api.createText({ x: 100, y: 50 });

      const ops = options.applyOps.mock.calls[0]?.[0] ?? [];
      const item = ops[0]!.item;
      expect(item.x).toBe(100 - TEXT_DEFAULT_WIDTH / 2);
      expect(item.y).toBe(50 - TEXT_DEFAULT_HEIGHT / 2);
      expect(item.content).toEqual({ type: 'text', text: '' });
      expect(api.pendingEditId.value).toBe('test-uuid-0');
    });
  });

  describe('onPaneClick — image tool', () => {
    it('переключает на select до открытия диалога, затем создаёт image по выбранному файлу', async () => {
      const options = makeOptions();
      const api = useBoardCreation(options);
      api.activeTool.value = 'image';

      const file = new File(['data'], 'test.png', { type: 'image/png' });
      const mockInput = {
        type: '',
        accept: '',
        style: { display: '' } as CSSStyleDeclaration,
        files: [file] as unknown as FileList,
        click: vi.fn(),
        addEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
          if (event === 'change') {
            setTimeout(() => handler(new Event('change')), 0);
          }
        }),
        remove: vi.fn(),
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockInput as unknown as HTMLInputElement);
      vi.spyOn(document.body, 'appendChild').mockReturnValue(mockInput as unknown as Node);

      uploadBoardAsset.mockResolvedValue({
        ok: true,
        asset: { url: 'u', width: 100, height: 100 },
      });

      api.onPaneClick(new MouseEvent('click', { clientX: 100, clientY: 50 }));

      // Инструмент переключается на select НЕМЕДЛЕННО, до await
      expect(api.activeTool.value).toBe('select');

      await new Promise((r) => setTimeout(r, 10));
      expect(options.applyOps).toHaveBeenCalledTimes(1);
      expect(mockInput.remove).toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });
});
