import type {
  BoardItem,
  BoardOp,
  BoardDiagramContent,
  BoardDiagramKind,
  BoardDiagramNotation,
  EmojiSequence,
  GiphyGifSummary,
  PersonalStickerFormat,
} from '@estimate/shared';
import {
  BOARD_IMAGE_ALLOWED_MIME_TYPES,
  BOARD_MAX_ITEMS,
  getDiagramNodeSpec,
} from '@estimate/shared';
import { useToast } from '@nuxt/ui/composables';
import { nextTick, ref, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  EMOJI_DEFAULT_HEIGHT,
  EMOJI_DEFAULT_WIDTH,
  STICKER_DEFAULT_HEIGHT,
  STICKER_DEFAULT_WIDTH,
  fitImageToDefaultBox,
  minZIndex,
  nextZIndexAbove,
  SHAPE_DEFAULT_COLOR,
  SHAPE_DEFAULT_HEIGHT,
  SHAPE_DEFAULT_WIDTH,
  STICKY_DEFAULT_COLOR,
  STICKY_DEFAULT_HEIGHT,
  STICKY_DEFAULT_WIDTH,
  TEXT_DEFAULT_HEIGHT,
  TEXT_DEFAULT_WIDTH,
} from '../../../features/boards/config/board-item-defaults';
import {
  FRAME_DEFAULT_HEIGHT,
  FRAME_DEFAULT_WIDTH,
} from '../../../features/boards/config/board-constants';
import { uuid } from '../../../features/boards/infrastructure/uuid';
import { uploadBoardAsset } from '../api/boards-api';
import type { BoardTool } from '../board-tools';

export interface UseBoardCreationOptions {
  boardId: () => string;
  canEdit: () => boolean;
  getItems: () => readonly BoardItem[];

  getCanvasRect: () => DOMRect | undefined;
  project: (point: { x: number; y: number }) => { x: number; y: number };

  // Возвращает только frame под точкой, согласно текущей логике Canvas.
  findContainerAt: (point: { x: number; y: number }) => BoardItem | undefined;

  // Canvas остаётся владельцем boardSession.
  applyOps: (ops: BoardOp[]) => void;

  // Canvas остаётся владельцем follow-mode; composable лишь вызывает callback.
  breakFollowOnEdit: () => void;

  /**
   * Выделяет только что созданный элемент в Vue Flow (тот же примитив, что уже
   * использует вставка/дублирование в `use-board-clipboard.ts`). Без этого
   * новый элемент оставался НЕ выделенным — плавающий тулбар выделения
   * (`selectionToolbarPosition` в `use-board-selection.ts`) целиком завязан на
   * `selectedNodes`, поэтому цвет текста/начертание/маркер и другие действия
   * тулбара были недоступны сразу после создания через инструмент, пока
   * пользователь не кликал по элементу ещё раз. Раньше это маскировалось
   * другим багом (автофокус текста не срабатывал сразу — см. `startEditing`
   * в `use-rich-text-editing.ts`): вынужденный повторный клик, чтобы вообще
   * начать печатать, заодно и выделял узел. После фикса автофокуса баг стал
   * заметен напрямую — набор текста сразу работает, а тулбар форматирования
   * всё ещё недоступен, пока не кликнешь (найдено пользователем 26.08.2026).
   */
  selectItems: (ids: readonly string[]) => void;
}

export interface UploadedBoardImage {
  url: string;
  width: number;
  height: number;
}

export function useBoardCreation(options: UseBoardCreationOptions): {
  activeTool: Ref<BoardTool>;
  pendingEditId: Ref<string | null>;

  canCreateItems: (count: number) => boolean;
  canCreateItem: () => boolean;

  pickImageFile: () => Promise<File | null>;
  uploadImage: (file: File) => Promise<UploadedBoardImage | null>;

   createSticky: (center: { x: number; y: number }) => void;
  createShape: (center: { x: number; y: number }) => void;
  createText: (center: { x: number; y: number }) => void;
  createFrame: (center: { x: number; y: number }) => void;
  createImage: (center: { x: number; y: number }, file: File) => Promise<void>;
  createEmojiAtCenter: (emoji: EmojiSequence) => void;
  createStickerAtCenter: (pack: string, id: string, format?: PersonalStickerFormat) => void;
  createGiphyAtCenter: (gif: GiphyGifSummary) => void;
  createDiagram: (center: { x: number; y: number }, notation: BoardDiagramNotation, kind: BoardDiagramKind) => void;

  cancelPendingEdit: () => void;

  onPaneClick: (event: MouseEvent) => void;
  onPaneDoubleClick: (event: MouseEvent) => void;
  onPaneDrop: (event: DragEvent) => void;
} {
  const { t } = useI18n();
  const toast = useToast();

  const activeTool = ref<BoardTool>('select');
  const pendingEditId = ref<string | null>(null);

  function canCreateItems(count: number): boolean {
    if (!options.canEdit()) return false;
    if (options.getItems().length + count > BOARD_MAX_ITEMS) {
      toast.add({ title: t('board.itemLimitReached'), color: 'error' });
      return false;
    }
    return true;
  }

  function canCreateItem(): boolean {
    return canCreateItems(1);
  }

  function flowPositionFromEvent(event: MouseEvent): { x: number; y: number } {
    const rect = options.getCanvasRect();
    if (!rect) return { x: 0, y: 0 };
    return options.project({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  /** Ждём, пока `item.create` дойдёт до `nodes` Vue Flow (см. паттерн в
   *  `use-board-clipboard.ts`), иначе `selectItems` целится в ещё не
   *  существующий в графе узел. */
  function selectAfterCreate(id: string): void {
    void nextTick(() => options.selectItems([id]));
  }

  function createSticky(center: { x: number; y: number }): void {
    if (!canCreateItem()) return;
    const id = uuid();
    pendingEditId.value = id;
    void options.applyOps([
      {
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id,
          parentId: options.findContainerAt(center)?.id ?? null,
          x: center.x - STICKY_DEFAULT_WIDTH / 2,
          y: center.y - STICKY_DEFAULT_HEIGHT / 2,
          width: STICKY_DEFAULT_WIDTH,
          height: STICKY_DEFAULT_HEIGHT,
          rotation: 0,
          zIndex: nextZIndexAbove(options.getItems()),
          content: { type: 'sticky', text: '' },
          style: { color: STICKY_DEFAULT_COLOR },
          reactions: [],
        },
      },
    ]);
    selectAfterCreate(id);
  }

  function createShape(center: { x: number; y: number }): void {
    if (!canCreateItem()) return;
    const id = uuid();
    pendingEditId.value = id;
    void options.applyOps([
      {
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id,
          parentId: options.findContainerAt(center)?.id ?? null,
          x: center.x - SHAPE_DEFAULT_WIDTH / 2,
          y: center.y - SHAPE_DEFAULT_HEIGHT / 2,
          width: SHAPE_DEFAULT_WIDTH,
          height: SHAPE_DEFAULT_HEIGHT,
          rotation: 0,
          zIndex: nextZIndexAbove(options.getItems()),
          content: { type: 'shape', shape: 'rectangle', text: '' },
          style: { color: SHAPE_DEFAULT_COLOR },
          reactions: [],
        },
      },
    ]);
    selectAfterCreate(id);
  }

  function createText(center: { x: number; y: number }): void {
    if (!canCreateItem()) return;
    const id = uuid();
    pendingEditId.value = id;
    void options.applyOps([
      {
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id,
          parentId: options.findContainerAt(center)?.id ?? null,
          x: center.x - TEXT_DEFAULT_WIDTH / 2,
          y: center.y - TEXT_DEFAULT_HEIGHT / 2,
          width: TEXT_DEFAULT_WIDTH,
          height: TEXT_DEFAULT_HEIGHT,
          rotation: 0,
          zIndex: nextZIndexAbove(options.getItems()),
          content: { type: 'text', text: '' },
          style: { color: STICKY_DEFAULT_COLOR },
          reactions: [],
        },
      },
    ]);
    selectAfterCreate(id);
  }

  function createFrame(center: { x: number; y: number }): void {
    if (!canCreateItem()) return;
    const id = uuid();
    pendingEditId.value = id;
    void options.applyOps([
      {
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id,
          parentId: null,
          x: center.x - FRAME_DEFAULT_WIDTH / 2,
          y: center.y - FRAME_DEFAULT_HEIGHT / 2,
          width: FRAME_DEFAULT_WIDTH,
          height: FRAME_DEFAULT_HEIGHT,
          rotation: 0,
          // Фрейм создаётся ПОЗАДИ уже существующих элементов (как в Miro)
          zIndex: minZIndex(options.getItems()) - 1,
          content: { type: 'frame', title: '' },
          style: { color: STICKY_DEFAULT_COLOR },
          reactions: [],
        },
      },
    ]);
    selectAfterCreate(id);
  }

  function createDiagram(
    center: { x: number; y: number },
    notation: BoardDiagramNotation,
    kind: BoardDiagramKind,
  ): void {
    if (!canCreateItem()) return;
    const spec = getDiagramNodeSpec(notation, kind);
    if (!spec) return;
    const id = uuid();
    pendingEditId.value = id;
    void options.applyOps([
      {
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id,
          parentId: options.findContainerAt(center)?.id ?? null,
          x: center.x - spec.defaultWidth / 2,
          y: center.y - spec.defaultHeight / 2,
          width: spec.defaultWidth,
          height: spec.defaultHeight,
          rotation: 0,
          zIndex: nextZIndexAbove(options.getItems()),
          content: { type: 'diagram', notation, kind, text: '' } as BoardDiagramContent,
          style: { color: SHAPE_DEFAULT_COLOR },
          reactions: [],
        },
      },
    ]);
    selectAfterCreate(id);
  }

  function createEmojiAtCenter(emoji: EmojiSequence): void {
    options.breakFollowOnEdit();
    if (!options.canEdit() || !canCreateItem()) return;
    const rect = options.getCanvasRect();
    if (!rect) return;
    const center = options.project({ x: rect.width / 2, y: rect.height / 2 });

    const id = uuid();
    void options.applyOps([
      {
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id,
          parentId: options.findContainerAt(center)?.id ?? null,
          x: center.x - EMOJI_DEFAULT_WIDTH / 2,
          y: center.y - EMOJI_DEFAULT_HEIGHT / 2,
          width: EMOJI_DEFAULT_WIDTH,
          height: EMOJI_DEFAULT_HEIGHT,
          rotation: 0,
          zIndex: nextZIndexAbove(options.getItems()),
          content: { type: 'emoji', emoji },
          style: { color: STICKY_DEFAULT_COLOR },
          reactions: [],
        },
      },
    ]);
    selectAfterCreate(id);
  }

  function createStickerAtCenter(pack: string, id: string, format?: PersonalStickerFormat): void {
    options.breakFollowOnEdit();
    if (!options.canEdit() || !canCreateItem()) return;
    const rect = options.getCanvasRect();
    if (!rect) return;
    const center = options.project({ x: rect.width / 2, y: rect.height / 2 });

    const itemId = uuid();
    void options.applyOps([
      {
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id: itemId,
          parentId: options.findContainerAt(center)?.id ?? null,
          x: center.x - STICKER_DEFAULT_WIDTH / 2,
          y: center.y - STICKER_DEFAULT_HEIGHT / 2,
          width: STICKER_DEFAULT_WIDTH,
          height: STICKER_DEFAULT_HEIGHT,
          rotation: 0,
          zIndex: nextZIndexAbove(options.getItems()),
          content: format ? { type: 'sticker', pack, id, format } : { type: 'sticker', pack, id },
          style: { color: STICKY_DEFAULT_COLOR },
          reactions: [],
        },
      },
    ]);
    selectAfterCreate(itemId);
  }

  /** Вставка GIF из Giphy (21.9) — аналогично картинке (13.2): естественный размер
   *  GIF вписывается в дефолтный бокс с сохранением пропорций, не растягивается на
   *  фиксированный квадрат, как стикер/эмодзи. */
  function createGiphyAtCenter(gif: GiphyGifSummary): void {
    options.breakFollowOnEdit();
    if (!options.canEdit() || !canCreateItem()) return;
    const rect = options.getCanvasRect();
    if (!rect) return;
    const center = options.project({ x: rect.width / 2, y: rect.height / 2 });
    const { width, height } = fitImageToDefaultBox(gif.width, gif.height);

    const itemId = uuid();
    void options.applyOps([
      {
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id: itemId,
          parentId: options.findContainerAt(center)?.id ?? null,
          x: center.x - width / 2,
          y: center.y - height / 2,
          width,
          height,
          rotation: 0,
          zIndex: nextZIndexAbove(options.getItems()),
          content: { type: 'giphy', id: gif.id, width: gif.width, height: gif.height },
          style: { color: STICKY_DEFAULT_COLOR },
          reactions: [],
        },
      },
    ]);
    selectAfterCreate(itemId);
  }

  /** Создаёт скрытый input[type=file], возвращает выбранный файл или null при отмене */
  function pickImageFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = BOARD_IMAGE_ALLOWED_MIME_TYPES.join(',');
      input.style.display = 'none';
      // И выбор файла, и отмена диалога должны убрать за собой скрытый input
      const cleanup = (file: File | null): void => {
        input.remove();
        resolve(file);
      };
      input.addEventListener('change', () => cleanup(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => cleanup(null));
      document.body.appendChild(input);
      input.click();
    });
  }

  /** Загружает файл картинки на доску и возвращает URL с размерами */
  async function uploadImage(file: File): Promise<UploadedBoardImage | null> {
    const loadingToast = toast.add({ title: t('board.imageUploading'), color: 'info' });
    const result = await uploadBoardAsset(options.boardId(), file);
    toast.remove(loadingToast.id);
    if (result.ok) return result.asset;
    if (result.reason === 'invalid_type') {
      toast.add({ title: t('board.imageInvalidType'), color: 'error' });
    } else if (result.reason === 'too_large') {
      toast.add({ title: t('board.imageTooLarge'), color: 'error' });
    } else if (result.reason === 'forbidden') {
      toast.add({ title: t('board.imageNoPermission'), color: 'error' });
    } else {
      toast.add({ title: t('board.imageUploadFailed'), color: 'error' });
    }
    return null;
  }

  /** Создаёт элемент-картинку: сначала загружает файл на сервер, затем создаёт элемент с возвращённым URL */
  async function createImage(center: { x: number; y: number }, file: File): Promise<void> {
    if (!canCreateItem()) return;
    if (!options.canEdit()) return;

    const id = uuid();
    pendingEditId.value = id;

    const result = await uploadImage(file);
    // Сбрасываем «висящий» pendingEditId только если он всё ещё от этой же
    // попытки — иначе параллельная более поздняя загрузка (новый id) осталась бы
    // заблокированной навсегда (W-15).
    if (!result) {
      if (pendingEditId.value === id) pendingEditId.value = null;
      return;
    }

    const { width, height } = fitImageToDefaultBox(result.width, result.height);
    void options.applyOps([
      {
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id,
          parentId: options.findContainerAt(center)?.id ?? null,
          x: center.x - width / 2,
          y: center.y - height / 2,
          width,
          height,
          rotation: 0,
          zIndex: nextZIndexAbove(options.getItems()),
          content: { type: 'image', url: result.url, width: result.width, height: result.height },
          style: { color: STICKY_DEFAULT_COLOR },
          reactions: [],
        },
      },
    ]);
    selectAfterCreate(id);
  }

  function cancelPendingEdit(): void {
    pendingEditId.value = null;
  }

  function onPaneClick(event: MouseEvent): void {
    // Клик пустым инструментом (select/arrow) ничего не создаёт и не редактирует —
    // follow-mode рвать незачем, иначе обычный клик для снятия выделения во время
    // слежения обрывал бы его без какого-либо реального вмешательства в доску
    if (
      activeTool.value !== 'sticky' &&
      activeTool.value !== 'shape' &&
      activeTool.value !== 'text' &&
      activeTool.value !== 'image' &&
      activeTool.value !== 'frame' &&
      activeTool.value !== 'diagram-uml-actor' &&
      activeTool.value !== 'diagram-bpmn-task'
    ) {
      return;
    }
    options.breakFollowOnEdit();
    const center = flowPositionFromEvent(event);
    if (activeTool.value === 'sticky') {
      createSticky(center);
    } else if (activeTool.value === 'shape') {
      createShape(center);
    } else if (activeTool.value === 'text') {
      createText(center);
    } else if (activeTool.value === 'image') {
      activeTool.value = 'select';
      void pickImageFile().then((file) => {
        if (file) void createImage(center, file);
      });
      return;
    } else if (activeTool.value === 'frame') {
      createFrame(center);
    } else if (activeTool.value === 'diagram-uml-actor') {
      createDiagram(center, 'uml', 'actor');
    } else if (activeTool.value === 'diagram-bpmn-task') {
      createDiagram(center, 'bpmn', 'task');
    }
    activeTool.value = 'select';
  }

  function onPaneDoubleClick(event: MouseEvent): void {
    if (!(event.target as HTMLElement).classList.contains('vue-flow__pane')) return;
    options.breakFollowOnEdit();
    createSticky(flowPositionFromEvent(event));
  }

  function onPaneDrop(event: DragEvent): void {
    if (!options.canEdit()) return;
    options.breakFollowOnEdit();
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) {
      void createImage(flowPositionFromEvent(event), file);
    }
  }

  return {
    activeTool,
    pendingEditId,
    canCreateItems,
    canCreateItem,
    pickImageFile,
    uploadImage,
    createSticky,
    createShape,
    createText,
    createFrame,
    createImage,
    createEmojiAtCenter,
    createStickerAtCenter,
    createGiphyAtCenter,
    createDiagram,
    cancelPendingEdit,
    onPaneClick,
    onPaneDoubleClick,
    onPaneDrop,
  };
}
