import type {
  BoardColorHex,
  BoardFontSizeMode,
  BoardHighlightColor,
  BoardItem,
  BoardItemContent,
  BoardItemPatchOp,
  BoardOp,
  BoardTextAlign,
  BoardTextMark,
  EmojiSequence,
  GiphyGifSummary,
  PersonalStickerFormat,
} from '@estimate/shared';
import { isBoardContainer } from '@estimate/shared';
import {
  FIT_FONT_MAX,
  getScaledFontSize,
} from '../../../features/boards/composables/use-fit-font-size';
import { BOARD_ITEM_FONT_SIZE_MAX, BOARD_ITEM_FONT_SIZE_MIN } from '@estimate/shared';
import { computed, ref, shallowRef } from 'vue';

import type { BoardEffectiveFontSizeRegistry } from '../context/board-canvas-keys';
import type { FrameSizePresetKey } from '../config/board-constants';
import {
  emojiSwapOps,
  frameSizePresetOps,
  giphySwapOps,
  stickerSwapOps,
} from './use-board-selection-ops';
import type { ItemFormKind } from '../board-item-form';
import type { BoardContextMenuTarget } from '../board-context-menu';
import type { FormatMarkKey } from './use-rich-text-editing';
import {
  type BoardSelectionEdge,
  type BoardSelectionNode,
} from '../../../features/boards/adapters/vue-flow-adapter';
import { uuid } from '../../../features/boards/infrastructure/uuid';
import {
  applyMarkToRange,
  getActiveMarks,
  runsFromContent,
  runsPlainText,
} from '../rich-text/board-rich-text';

/** Стикер/фигура/текст — единственные типы с текстовым содержимым (runs/text) */
function isTextBearingContent(
  content: BoardItemContent,
): content is Extract<BoardItemContent, { type: 'sticky' | 'shape' | 'text' }> {
  return content.type === 'sticky' || content.type === 'shape' || content.type === 'text';
}

export interface BoardSelectionOptions {
  canEdit: () => boolean;
  /** Идёт ли сейчас drag узла (19.30/22.7): пока `true`, тулбар выделения скрыт —
   * иначе он держится на весу над стикером и мешает целиться курсором при
   * перетаскивании (в Miro тулбар прячется на время drag и появляется снова
   * на отпускании, выделение при этом не сбрасывается). */
  isDragging: () => boolean;
  /** Плоский список всех элементов доски (без связей). */
  getItems: () => BoardItem[];
  /** Все узлы Vue Flow: нужны чтобы перебрать и переключить `.selected` у рендерится иных
   * объектов (они — те же экземпляры, что отрисовывает Vue Flow), а также чтобы
   * быстро найти узел по id для операций группы. */
  getNodes: () => BoardSelectionNode[];
  /** Все связи Vue Flow — аналогично узлам: перебор ради `.selected`/`edge.data` на
   * живых объектах. */
  getEdges: () => BoardSelectionEdge[];
  getCanvasRect: () => DOMRect | undefined;
  getViewport: () => Viewport;
  /** Текущие выделенные узлы Vue Flow (уже сузили до BoardItem). */
  getSelectedNodes: () => BoardSelectionNode[];
  /** Текущие выделенные связи Vue Flow (уже сузили до BoardEdge). */
  getSelectedEdges: () => BoardSelectionEdge[];
  applyOps: (ops: BoardOp[]) => void;
  canCreateItem: () => boolean;
  /** Клик по пустому месту холста — делегируется Canvas (логика создания элемента). */
  onContainerClick: (event: MouseEvent) => void;
  pickImageFile: () => Promise<File | null>;
  uploadImage: (file: File) => Promise<{ url: string; width: number; height: number } | null>;
  activeTool: () => string;
  breakFollowOnEdit: () => void;
  /** max/min zIndex среди всех элементов — Canvas вычисляет через board-item-defaults. */
  getBoardZIndex: () => { max: number; min: number };
  /** Цвет заливки по умолчанию для новых групп (без него composable импортировал бы
   * board-item-defaults ради одной константы). */
  defaultItemColor: BoardColorHex;
  /** Автоподбор контрастного цвета текста под заливку текущей темы. */
  resolveTextColor: (itemColor: BoardColorHex) => BoardColorHex;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Логика выделения доски (12.6+12.9+12.13+14.3): тулбар выделения, контекстное
 * меню, группировка/разгруппировка, замена картинки, операции над текстом/цветом/
 * слоями и live-превью цвета. Вынесена из `BoardCanvas.vue`, чтобы тот не
 * импортировал детали DOM/board-item-defaults в доменную модель, а Canvas
 * оставался лишь владельцем холста (Vue Flow + boardSession + follow-mode).
 *
 * Composable Не зависит от `@vue-flow/core` и `board-items-defaults`/`board-colors`
 * напрямую: координаты viewport/холста, z-index, цветовые токены и размеры
 * по умолчанию — всё это адаптерные callbacks из Canvas. Единственное, что
 * импортируется — чистая математика шрифта из `use-fit-font-size`.
 */
export function useBoardSelection(options: BoardSelectionOptions) {
  const selectedNodes = computed(() => options.getSelectedNodes());
  const selectedEdges = computed(() => options.getSelectedEdges());

  /* ----------------------- Выполнимые операции ----------------------- */

  function patchSelected(patchByNode: (node: BoardSelectionNode, index: number) => BoardOp): void {
    const ops = selectedNodes.value.map(patchByNode);
    if (ops.length) void options.applyOps(ops);
  }

  function patchSelectedEdge(patchByEdge: (edge: BoardSelectionEdge) => BoardOp): void {
    const ops = selectedEdges.value.map(patchByEdge);
    if (ops.length) void options.applyOps(ops);
  }

  /* ------------------------- Live-превью цвета ------------------------- */

  /**
   * Сессии «превью кастомного цвета» из UColorPicker (18.4, баг с живой
   * проверки): drag красит объект live через ту же `applyOps`, что и обычный
   * коммит. Раньше отмена (BoardColorPickerMenu, попап закрыт без «Применить»)
   * шла через тот же путь, что и live-превью, и патчила ТЕКУЩЕЕ выделение
   * (`patchSelected`/`patchSelectedEdge`) — а клик мимо объекта синхронно
   * снимает выделение РАНЬШЕ, чем успевает отработать откат: к моменту, когда
   * приходит эмит отмены, выделение уже пустое, патч не бьёт никуда, откат
   * молча теряется, цвет остаётся висеть на объекте перманентно.
   *
   * Фикс — не читать выделение на каждый тик, а зафиксировать id один раз в
   * начале сессии (первый вызов preview после явного коммита/отмены) и всегда
   * использовать именно эти id, включая финальную отмену — тогда она бьёт в
   * тот же объект, что и живое превью, независимо от состояния выделения к
   * моменту закрытия попапа. Коммит (клик по свотчу/«Применить», через
   * patchSelected/patchSelectedEdge выше) ЗАВЕРШАЕТ сессию — сбрасывает id в
   * null. Отмена — это ОТДЕЛЬНОЕ, не переиспользующее preview, событие
   * (`BoardColorPickerMenu`'s `cancel`) ИМЕННО потому, что тоже обязана
   * завершить сессию: если бы отмена шла через preview, id остались бы
   * зафиксированными, и следующее открытие пикера (даже на другом объекте)
   * красило бы старый.
   */
  let colorPreviewIds: string[] | null = null;
  let textColorPreviewIds: string[] | null = null;

  function previewSelectedColor(color: BoardColorHex): void {
    colorPreviewIds ??= selectedNodes.value.map((node) => node.id);
    const ops: BoardOp[] = colorPreviewIds.map((id) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id,
      patch: { style: { color } },
    }));
    if (ops.length) void options.applyOps(ops);
  }

  function cancelSelectedColorPreview(originalColor: BoardColorHex): void {
    const ids = colorPreviewIds;
    colorPreviewIds = null;
    if (!ids?.length) return;
    const ops: BoardOp[] = ids.map((id) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id,
      patch: { style: { color: originalColor } },
    }));
    void options.applyOps(ops);
  }

  function previewSelectedTextColor(textColor: BoardColorHex): void {
    textColorPreviewIds ??= selectedNodes.value.map((node) => node.id);
    const ops: BoardOp[] = textColorPreviewIds.map((id) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id,
      patch: { style: { textColor } },
    }));
    if (ops.length) void options.applyOps(ops);
  }

  function cancelSelectedTextColorPreview(originalTextColor: BoardColorHex): void {
    const ids = textColorPreviewIds;
    textColorPreviewIds = null;
    if (!ids?.length) return;
    const ops: BoardOp[] = ids.map((id) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id,
      patch: { style: { textColor: originalTextColor } },
    }));
    void options.applyOps(ops);
  }

  /* ----------------------- Позиции тулбаров ----------------------- */

  /** Плавающий тулбар над выделением узлов (12.6; скрыт во время drag — 22.7). */
  const selectionToolbarPosition = computed(() => {
    const selected = selectedNodes.value;
    if (!options.canEdit() || selected.length === 0 || options.isDragging()) return null;
    const left = Math.min(...selected.map((node) => node.computedPosition.x));
    const right = Math.max(
      ...selected.map((node) => node.computedPosition.x + node.dimensions.width),
    );
    const top = Math.min(...selected.map((node) => node.computedPosition.y));
    const viewport = options.getViewport();
    return {
      left: viewport.x + ((left + right) / 2) * viewport.zoom,
      top: viewport.y + top * viewport.zoom,
    };
  });

  /* ----------------------- Состояние выделения ----------------------- */

  /** Форма первого выделенного элемента — для иконки триггера в тулбаре выделения (12.7) */
  const selectedForm = computed<ItemFormKind>(() => {
    const content = selectedNodes.value[0]?.data.content;
    if (content?.type === 'shape') return content.shape;
    if (content?.type === 'text') return 'text';
    if (content?.type === 'image') return 'image';
    if (content?.type === 'emoji') return 'emoji';
    if (content?.type === 'sticker') return 'sticker';
    if (content?.type === 'giphy') return 'giphy';
    if (content?.type === 'frame') return 'frame';
    if (content?.type === 'group') return 'group';
    return 'sticky';
  });

  /** Цвет первого выделенного элемента — для кружка-триггера в тулбаре выделения (12.7) */
  const selectedColor = computed<BoardColorHex>(
    () => selectedNodes.value[0]?.data.style.color ?? options.defaultItemColor,
  );

  /* ----------------------- Runtime-size registry ----------------------- */

  /**
   * Узлы Vue Flow измеряют свой DOM сами, а тулбар живёт уровнем выше. Передаём
   * только производный runtime-размер через registry: ни в BoardItem, ни в WS
   * op он не попадает. Владелец registry — этот composable (жизненный цикл
   * совпадает с холстом), холст просто `provide`-ит его узлам.
   */
  const fontSizeSizes = shallowRef(new Map<string, number>());
  const effectiveFontSizeRegistry: BoardEffectiveFontSizeRegistry = {
    sizes: fontSizeSizes,
    set(itemId, fontSize) {
      fontSizeSizes.value = new Map(fontSizeSizes.value).set(itemId, fontSize);
    },
    remove(itemId) {
      if (!fontSizeSizes.value.has(itemId)) return;
      const next = new Map(fontSizeSizes.value);
      next.delete(itemId);
      fontSizeSizes.value = next;
    },
  };

  /** Сохранённый базовый размер — только для изменения +/- и его границ. */
  const selectedBaseFontSize = computed<number>(
    () => selectedNodes.value[0]?.data.style.fontSize ?? FIT_FONT_MAX,
  );

  /** Не задано — `auto` (масштабируется с боксом, как было до этой задачи). */
  const selectedFontSizeMode = computed<BoardFontSizeMode>(
    () => selectedNodes.value[0]?.data.style.fontSizeMode ?? 'auto',
  );

  /**
   * Тулбар показывает размер, который реально нарисовал node. Пока node ещё
   * не смонтирован, fallback — сохранённая база: она уже актуальна для
   * текущего бокса в ОБОИХ режимах (26.08.2026) — в `auto` её пересчитывает
   * пропорционально самому resize `onResizeEnd` в момент действия, а не
   * реактивная геометрическая формула здесь (раньше формула сравнивала
   * текущий бокс с ФИКСИРОВАННОЙ геометрией элемента по умолчанию, из-за чего
   * переключение auto↔manual могло дать неожиданный скачок числа — баг,
   * найден пользователем). После DOM-fit registry заменяет фоллбэк точным
   * значением с учётом длины и форматирования текста.
   */
  const selectedFontSize = computed<number>(() => {
    const node = selectedNodes.value[0];
    if (!node) return FIT_FONT_MAX;
    const measured = fontSizeSizes.value.get(node.id);
    return measured ?? selectedBaseFontSize.value;
  });
  /**
   * «Увеличить» не должно молча ничего не делать, когда бокс уже не может
   * вместить больший шрифт — авто-fit (`useFitFontSize`) в этом случае тут же
   * ужимает отрисованный размер обратно к тому, что реально помещается, и с
   * точки зрения пользователя кнопка выглядит сломанной (клик есть, видимого
   * эффекта нет, никакой обратной связи). Пока `selectedFontSize` (реально
   * отрисованный размер) меньше `selectedBaseFontSize` (запрошенный) — бокс
   * уже исчерпал место для текущего содержимого, дальше расти некуда без
   * ручного увеличения самого бокса — кнопка должна быть задизейблена, а не
   * тихо съедать клики (баг, найден пользователем 26.08.2026, ярче всего
   * проявлялся на текстовом элементе — его дефолтный бокс, `TEXT_DEFAULT_HEIGHT`,
   * рассчитан впритык под ОДИН размер шрифта по умолчанию, без всякого запаса
   * на «+», но тот же тупик воспроизводится на любом достаточно уменьшенном
   * вручную стикере/фигуре — механизм общий для всех типов).
   */
  const canIncreaseSelectedFontSize = computed(
    () =>
      selectedBaseFontSize.value < BOARD_ITEM_FONT_SIZE_MAX &&
      selectedFontSize.value >= selectedBaseFontSize.value,
  );
  const canDecreaseSelectedFontSize = computed(
    () => selectedBaseFontSize.value > BOARD_ITEM_FONT_SIZE_MIN,
  );
  const selectedTextColor = computed<BoardColorHex>(
    () =>
      selectedNodes.value[0]?.data.style.textColor ?? options.resolveTextColor(selectedColor.value),
  );
  const selectedTextAlign = computed<BoardTextAlign>(
    () => selectedNodes.value[0]?.data.style.textAlign ?? 'center',
  );

  /**
   * Метки начертания/маркера для тулбара, когда элемент просто ВЫДЕЛЕН, а не
   * активно редактируется — тот же fallback «весь текст», что `resolveFormatRange`
   * в `use-rich-text-editing.ts` уже применяет при схлопнутом курсоре внутри
   * активного редактора (18.7), только распространённый на случай, когда
   * редактор вообще не открыт. До этого начертание/маркер работали ТОЛЬКО во
   * время реального редактирования — просто выделенный элемент не давал их
   * применить вовсе, хотя цвет текста и размер шрифта прекрасно патчатся без
   * входа в редактирование (баг, найден пользователем 26.08.2026). Источник —
   * первый выделенный узел с непустым текстовым контентом, как и
   * `selectedColor`/`selectedTextColor` выше. `null` — нет текста (нечего
   * форматировать), `{}` — текст есть, но без активных меток.
   */
  const selectedActiveMarks = computed<BoardTextMark | null>(() => {
    const content = selectedNodes.value[0]?.data.content;
    if (!content || !isTextBearingContent(content)) return null;
    const runs = runsFromContent(content);
    const text = runsPlainText(runs);
    if (text.length === 0) return null;
    return getActiveMarks(runs, 0, text.length);
  });

  /**
   * Патчит начертание/маркер сразу в данных (`content.runs`), без живого
   * `editableEl` — companion к `applyRangePatch` в `use-rich-text-editing.ts`,
   * которая делает то же самое, но поверх DOM активного редактора. Действует
   * на ВСЕ выделенные узлы с непустым текстом (сравни с `patchSelected`, но с
   * пропуском узлов без подходящего контента — не каждый узел в выделении
   * обязан быть текстовым). Направление тоггла берётся из состояния ПЕРВОГО
   * узла (`selectedActiveMarks`) — при смешанном выделении все узлы после
   * клика синхронизируются к одному состоянию, как и у большинства редакторов.
   */
  function patchSelectedWholeTextMark(patch: (marks: BoardTextMark) => BoardTextMark): void {
    const ops: BoardOp[] = [];
    for (const node of selectedNodes.value) {
      const content = node.data.content;
      if (!isTextBearingContent(content)) continue;
      const runs = runsFromContent(content);
      const text = runsPlainText(runs);
      if (text.length === 0) continue;
      const nextRuns = applyMarkToRange(runs, 0, text.length, patch);
      const hasFormatting = nextRuns.some((run) => run.marks);
      ops.push({
        type: 'item.patch',
        clientOpId: uuid(),
        id: node.id,
        patch: { content: { ...content, text, runs: hasFormatting ? nextRuns : undefined } },
      });
    }
    if (ops.length) void options.applyOps(ops);
  }

  function toggleSelectedMark(key: FormatMarkKey): void {
    const active = selectedActiveMarks.value;
    patchSelectedWholeTextMark((marks) => ({ ...marks, [key]: !active?.[key] }));
  }

  function setSelectedHighlight(color: BoardHighlightColor | null): void {
    patchSelectedWholeTextMark((marks) => ({ ...marks, highlight: color ?? undefined }));
  }

  /**
   * Единый переключатель «тип элемента» (12.7) — конвертирует ЛЮБОЕ выделение
   * (стикер, фигура, текст, картинка, смешанное) в выбранный тип/форму, сохраняя текст.
   * Рендер-компонент переключится сам — маппинг в `nodeTypes` идёт по
   * `content.type`, отдельно менять его не нужно.
   *
   * Геометрия фигуры при конвертации В стикер не сохраняется как есть: стикер
   * всегда квадрат (см. `keep-aspect-ratio` в `BoardStickyNode.vue`), поэтому
   * растянутая фигура (например, широкий прямоугольник) сжимается до квадрата
   * по МЕНЬШЕЙ стороне, с центром на прежнем месте — иначе конвертация назад
   * в стикер "запоминала" бы вытянутые пропорции, которых у стикера в принципе
   * не бывает (баг, найденный пользователем при ручной проверке). В обратную
   * сторону (стикер → фигура) геометрия не трогается — фигуры не обязаны быть
   * квадратом.
   *
   * Текстовый элемент (13.1) — без фона/заливки/рамки, auto-width по содержимому
   * не работает на уровне создания (нет измерения), поэтому при конвертации в
   * текст оставляем геометрию как есть (пользователь сам ресайзит при необходимости).
   *
   * Картинка (13.2) — при конвертации В картинку нельзя просто взять текст, нужно
   * загрузить файл. Поэтому конвертация в 'image' через тулбар недоступна —
   * в `BoardSelectionToolbar.vue` 'image' есть в списке для отображения текущего
   * типа, но конвертировать в него можно только через drag&drop/paste/инструмент.
   * Конвертация ИЗ картинки в другие типы — просто заменяет content на текстовый
   * (текст картинки теряется, url/width/height отбрасываются).
   */
  function setSelectedForm(kind: ItemFormKind): void {
    // Конвертация В картинку/эмодзи/стикер/GIF через общий пикер не поддерживается (нужен
    // файл или конкретный выбранный символ/пак/GIF) — у всех свой отдельный путь создания/замены
    if (kind === 'image' || kind === 'emoji' || kind === 'sticker' || kind === 'giphy') return;
    // Фрейм/группа (14.3) — контейнеры, конвертировать их в другие типы или наоборот
    // через общий переключатель не поддерживается — они управляются отдельными действиями
    if (kind === 'frame' || kind === 'group') return;

    patchSelected((node) => {
      // Форматирование (12.13) переживает конвертацию стикер↔фигура↔текст вместе с текстом
      const content = node.data.content;
      let newContent: BoardItemContent;
      if (kind === 'sticky') {
        if (
          content.type === 'image' ||
          content.type === 'emoji' ||
          content.type === 'sticker' ||
          content.type === 'giphy'
        ) {
          // Конвертация из картинки/эмодзи/стикера — просто создаём пустой стикер
          newContent = { type: 'sticky', text: '' };
        } else if (content.type === 'frame' || content.type === 'group') {
          newContent = { type: 'sticky', text: '' };
        } else {
          const { text, runs } = content;
          newContent = { type: 'sticky', text, ...(runs?.length ? { runs } : {}) };
        }
      } else if (kind === 'text') {
        if (
          content.type === 'image' ||
          content.type === 'emoji' ||
          content.type === 'sticker' ||
          content.type === 'giphy'
        ) {
          // Конвертация из картинки/эмодзи/стикера — пустой текст
          newContent = { type: 'text', text: '' };
        } else if (content.type === 'frame' || content.type === 'group') {
          newContent = { type: 'text', text: '' };
        } else {
          const { text, runs } = content;
          newContent = { type: 'text', text, ...(runs?.length ? { runs } : {}) };
        }
      } else {
        // kind is a BoardShapeKind
        if (
          content.type === 'image' ||
          content.type === 'emoji' ||
          content.type === 'sticker' ||
          content.type === 'giphy'
        ) {
          // Конвертация из картинки/эмодзи/стикера в фигуру — пустой текст
          newContent = { type: 'shape', shape: kind, text: '' };
        } else if (content.type === 'frame' || content.type === 'group') {
          newContent = { type: 'shape', shape: kind, text: '' };
        } else {
          const { text, runs } = content;
          newContent = { type: 'shape', shape: kind, text, ...(runs?.length ? { runs } : {}) };
        }
      }
      const patch: BoardItemPatchOp['patch'] = { content: newContent };
      if (kind === 'sticky') {
        const { x, y } = node.computedPosition;
        const { width, height } = node.dimensions;
        const side = Math.min(width, height);
        Object.assign(patch, {
          x: x + (width - side) / 2,
          y: y + (height - side) / 2,
          width: side,
          height: side,
        });
      }
      return {
        type: 'item.patch',
        clientOpId: uuid(),
        id: node.id,
        patch,
      };
    });
  }

  function setSelectedColor(color: BoardColorHex): void {
    colorPreviewIds = null;
    patchSelected((node) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { style: { color } },
    }));
  }

  /**
   * Явная установка размера (степпер +/- или прямой ввод числа) — сама по
   * себе решение пользователя зафиксировать конкретное значение (26.08.2026,
   * по референсу Miro): переключает режим в `manual`, даже если сам номер
   * численно не поменялся (см. финальную проверку ниже) — иначе выбор того
   * же числа, что уже показывает `auto`-режим, не переключил бы его.
   *
   * `fontSize` — это ЦЕЛЕВОЕ отображаемое значение (степпер шагает от
   * `currentFontSize` в `BoardSelectionToolbar.vue`, т.е. от того, что реально
   * нарисовано, включая масштабирование по боксу в `auto`). Раз результат
   * ЛЮБОГО вызова этой функции — `manual`, а в `manual` отображаемое ВСЕГДА
   * равно базе (никакого масштабирования по боксу), новая база — это просто
   * `fontSize` как есть, без какого-либо пересчёта под текущий scale.
   *
   * Раньше (до режима manual) здесь был пересчёт через `unscaleFontSizeStep` —
   * он транслировал целевой ОТОБРАЖАЕМЫЙ размер обратно в базу для дефолтной
   * геометрии, ПРЕДПОЛАГАЯ, что результат останется в `auto` (масштабируемым).
   * С момента, когда каждый вызов уводит в `manual`, это предположение больше
   * не верно — тот пересчёт давал НЕОЖИДАННЫЙ скачок вниз (баг, найден живой
   * проверкой 26.08.2026): на увеличенном боксе показывалось 30px, клик «+2»
   * переключал в manual и рисовал 21px вместо ожидаемых 32 — пользователь
   * нажал «увеличить», а шрифт визуально уменьшился.
   */
  function setSelectedFontSize(fontSize: number): void {
    const selected = selectedNodes.value[0];
    if (!selected) return;
    const currentBase = selectedBaseFontSize.value;
    const wasManual = selectedFontSizeMode.value === 'manual';
    const clampedBase = Math.min(
      BOARD_ITEM_FONT_SIZE_MAX,
      Math.max(BOARD_ITEM_FONT_SIZE_MIN, fontSize),
    );
    if (clampedBase === currentBase && wasManual) return;
    // Якорь (`fontSizeBoxWidth/Height`) сбрасывается на ТЕКУЩИЙ бокс каждого узла —
    // это число валидно именно для него ПРЯМО СЕЙЧАС, а не для геометрии на момент
    // последнего resize в auto (см. `setSelectedFontSizeMode` ниже: без этого сброса
    // последующий resize в manual считал бы расхождение от устаревшего якоря).
    patchSelected((node) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: {
        style: {
          fontSize: clampedBase,
          fontSizeMode: 'manual',
          fontSizeBoxWidth: node.data.width,
          fontSizeBoxHeight: node.data.height,
        },
      },
    }));
  }

  /**
   * Переключатель «Авто» в тулбаре (26.08.2026, по референсу Miro). Обратно в
   * `manual` — просто флаг, само число уже актуально для текущего бокса (в
   * `auto` инвариант «fontSize верен для текущей геометрии» поддерживается на
   * каждом resize). В `auto` — ДОСЧИТЫВАЕТ пропущенные изменения бокса: пока
   * был активен `manual`, resize двигал бокс, но не трогал ни `fontSize`, ни
   * якорь (`fontSizeBoxWidth/Height`), поэтому к моменту переключения они
   * могут заметно разойтись с текущей геометрией узла. Пересчитываем один раз
   * пропорционально этому расхождению (якорь → текущий бокс) — так само
   * переключение уже показывает верный для текущего размера стикера шрифт, не
   * дожидаясь следующего resize (баг из живой проверки: `manual=4` → resize
   * 2x → переключение на `auto` не меняло число, хотя бокс уже вырос).
   */
  function setSelectedFontSizeMode(mode: BoardFontSizeMode): void {
    if (selectedFontSizeMode.value === mode) return;
    if (mode === 'manual') {
      patchSelected((node) => ({
        type: 'item.patch',
        clientOpId: uuid(),
        id: node.id,
        patch: { style: { fontSizeMode: mode } },
      }));
      return;
    }
    patchSelected((node) => {
      const base = node.data.style.fontSize ?? FIT_FONT_MAX;
      const anchorWidth = node.data.style.fontSizeBoxWidth ?? node.data.width;
      const anchorHeight = node.data.style.fontSizeBoxHeight ?? node.data.height;
      const nextFontSize = Math.min(
        BOARD_ITEM_FONT_SIZE_MAX,
        Math.max(
          BOARD_ITEM_FONT_SIZE_MIN,
          getScaledFontSize(base, node.data.width, node.data.height, anchorWidth, anchorHeight),
        ),
      );
      return {
        type: 'item.patch',
        clientOpId: uuid(),
        id: node.id,
        patch: {
          style: {
            fontSize: nextFontSize,
            fontSizeMode: mode,
            fontSizeBoxWidth: node.data.width,
            fontSizeBoxHeight: node.data.height,
          },
        },
      };
    });
  }

  function setSelectedTextColor(textColor: BoardColorHex): void {
    textColorPreviewIds = null;
    patchSelected((node) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { style: { textColor } },
    }));
  }

  function setSelectedTextAlign(textAlign: BoardTextAlign): void {
    patchSelected((node) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { style: { textAlign } },
    }));
  }

  /** Смена эмодзи/стикера/GIF/шаблона размера фрейма — билдеры опов вынесены
   * в `use-board-selection-ops.ts` (лимит `max-lines`), здесь только вызов
   * с текущим выделением и коммит через `applyOps`. */
  function setSelectedEmoji(emoji: EmojiSequence): void {
    const ops = emojiSwapOps(emoji, selectedNodes.value);
    if (ops.length) void options.applyOps(ops);
  }

  function setSelectedSticker(pack: string, id: string, format?: PersonalStickerFormat): void {
    const ops = stickerSwapOps(pack, id, format, selectedNodes.value);
    if (ops.length) void options.applyOps(ops);
  }

  function setSelectedGiphy(gif: GiphyGifSummary): void {
    const ops = giphySwapOps(gif, selectedNodes.value);
    if (ops.length) void options.applyOps(ops);
  }

  function setSelectedFrameSize(preset: FrameSizePresetKey): void {
    const ops = frameSizePresetOps(preset, selectedNodes.value);
    if (ops.length) void options.applyOps(ops);
  }

  /** Можно сгруппировать: 2+ элемента выделено и среди них НЕТ уже готового контейнера (frame/group) (14.3) */
  const canGroupSelection = computed(
    () =>
      selectedNodes.value.length >= 2 &&
      !selectedNodes.value.some((n) => isBoardContainer(n.data.content.type)),
  );
  /** Можно разгруппировать: хотя бы один выделенный элемент сейчас внутри контейнера (14.3) */
  const canUngroupSelection = computed(() =>
    selectedNodes.value.some((n) => n.data.parentId !== null),
  );

  /**
   * Группировка выделения (14.3) — создаёт невидимую группу (container) и
   * переставляет выделенных элементов `parentId` на неё. Группа позиционируется
   * по bounding box выделения. `x`/`y` элементов в домене остаются абсолютными
   * (не пересчитываются) — относительную позицию для рендера Vue Flow делает
   * `vue-flow-adapter.ts` сам, по разнице с координатами родителя.
   *
   * Это атомарный батч: создали группу + перепривязали всех детей — сервер
   * применит всё по порядку (group.create сначала, потом patches с parentId),
   * так что FK-валидация не будет ругаться на несуществующего родителя.
   */
  function groupSelection(): void {
    if (!canGroupSelection.value || !options.canCreateItem()) return;
    const selected = selectedNodes.value;

    const left = Math.min(...selected.map((n) => n.computedPosition.x));
    const top = Math.min(...selected.map((n) => n.computedPosition.y));
    const right = Math.max(...selected.map((n) => n.computedPosition.x + n.dimensions.width));
    const bottom = Math.max(...selected.map((n) => n.computedPosition.y + n.dimensions.height));

    const groupId = uuid();
    const ops: BoardOp[] = [
      {
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id: groupId,
          parentId: null,
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
          rotation: 0,
          zIndex: options.getBoardZIndex().max + 1,
          content: { type: 'group' },
          style: { color: options.defaultItemColor },
          reactions: [],
        },
      },
      // Аннотация возврата, а не `as BoardOp`: контекстный тип массива не протекает
      // внутрь колбэка `.map` через спред, поэтому без неё `type` расширяется до
      // string и литерал перестаёт подходить под union. Аннотацию компилятор
      // проверяет, в отличие от утверждения.
      ...selected.map((node): BoardOp => ({
        type: 'item.patch',
        clientOpId: uuid(),
        id: node.id,
        patch: { parentId: groupId },
      })),
    ];
    void options.applyOps(ops);
  }

  /**
   * Разгруппировка (14.3). Группа — жёсткий пучок (не мини-холст, как фрейм):
   * разгруппировка любого её участника распускает ВСЮ группу целиком, а не
   * только выделенного (иначе часть участников осталась бы привязана к группе,
   * из которой других уже вынули — рассинхрон, которого в модели "жёсткого
   * пучка" быть не должно), и опустевшую группу сразу удаляем — иначе на доске
   * оставалась бы невидимая пустая оболочка, которую нечем выделить кроме как
   * случайно, и нечем удалить кроме явного клика точно по ней (найдено вручную).
   * Фрейм — не то же самое: он мини-холст, который пользователь мог осознанно
   * создать и хочет оставить даже пустым, так что для фрейма снимаем родителя
   * только у явно выделенного элемента, сам фрейм не трогаем.
   */
  function childrenOf(containerId: string): BoardItem[] {
    return options.getItems().filter((candidate) => candidate.parentId === containerId);
  }

  function ungroupSelection(): void {
    const ops: BoardOp[] = [];
    const dissolvedGroupIds = new Set<string>();

    /**
     * Распускает группу: участники наследуют РОДИТЕЛЯ САМОЙ ГРУППЫ (14.8) —
     * `null`, если группа была верхнеуровневой, либо id фрейма, если группа
     * была в него вложена. Раньше здесь был жёстко `null` — до 14.8 у группы
     * не могло быть родителя вообще, так что это давало тот же результат;
     * теперь жёсткий `null` вытолкнул бы участников из фрейма, из которого их
     * никто не вынимал.
     */
    function dissolveGroup(group: BoardItem): void {
      if (dissolvedGroupIds.has(group.id)) return;
      dissolvedGroupIds.add(group.id);
      for (const member of childrenOf(group.id)) {
        ops.push({
          type: 'item.patch',
          clientOpId: uuid(),
          id: member.id,
          patch: { parentId: group.parentId },
        });
      }
      ops.push({ type: 'item.delete', clientOpId: uuid(), id: group.id });
    }

    for (const node of selectedNodes.value) {
      // Сама группа выделена напрямую — возможно, только когда она вложена во
      // фрейм (14.8): у верхнеуровневой группы parentId всегда null, и
      // canUngroupSelection для неё одной не включился бы
      if (node.data.content.type === 'group') {
        dissolveGroup(node.data);
        continue;
      }
      const parentId = node.data.parentId;
      if (parentId === null) continue;
      const parent = options.getItems().find((candidate) => candidate.id === parentId);
      if (parent?.content.type === 'group') {
        dissolveGroup(parent);
      } else {
        ops.push({
          type: 'item.patch',
          clientOpId: uuid(),
          id: node.id,
          patch: { parentId: null },
        });
      }
    }
    if (ops.length) void options.applyOps(ops);
  }

  async function replaceSelectedImage(): Promise<void> {
    if (!options.canEdit()) return;
    const file = await options.pickImageFile();
    if (!file) return;
    const result = await options.uploadImage(file);
    if (!result) return;

    const ops: BoardOp[] = selectedNodes.value
      .filter((node) => node.data.content.type === 'image')
      .map((node) => ({
        type: 'item.patch',
        clientOpId: uuid(),
        id: node.id,
        patch: {
          content: { type: 'image', url: result.url, width: result.width, height: result.height },
        },
      }));
    if (ops.length) void options.applyOps(ops);
  }

  /**
   * Карточки и связи делят одно пространство порядка (12.21) — правым кликом
   * по связи (`target: 'edge'`) выделена связь, не карточка, поэтому обе
   * функции ниже должны уметь патчить оба вида выделения, а не только узлы,
   * как раньше (до появления `zIndex` у связи бринг-ту-фронт по факту
   * работал только для карточек). База (`max`/`min`) общая на весь батч —
   * `patchSelected`/`patchSelectedEdge` тут не подходят (нужен один общий
   * индекс на оба списка, не раздельные с 0), поэтому ops собираются вручную.
   */
  function bringSelectedToFront(): void {
    const base = options.getBoardZIndex().max + 1;
    const nodeOps: BoardOp[] = selectedNodes.value.map((node, index) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { zIndex: base + index },
    }));
    const edgeOps: BoardOp[] = selectedEdges.value.map((edge, index) => ({
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { zIndex: base + nodeOps.length + index },
    }));
    const ops = [...nodeOps, ...edgeOps];
    if (ops.length) options.applyOps(ops);
  }

  function sendSelectedToBack(): void {
    const total = selectedNodes.value.length + selectedEdges.value.length;
    const base = options.getBoardZIndex().min - total;
    const nodeOps: BoardOp[] = selectedNodes.value.map((node, index) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { zIndex: base + index },
    }));
    const edgeOps: BoardOp[] = selectedEdges.value.map((edge, index) => ({
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { zIndex: base + nodeOps.length + index },
    }));
    const ops = [...nodeOps, ...edgeOps];
    if (ops.length) options.applyOps(ops);
  }

  function deleteSelected(): void {
    patchSelected((node) => ({
      type: 'item.delete',
      clientOpId: uuid(),
      id: node.id,
    }));
  }

  /**
   * Удаление смешанного выделения — карточки И связи разом (12.22, хоткей
   * Delete/Backspace). Раньше это были два независимых батча (`deleteSelected`
   * + `deleteSelectedEdges` из use-board-edges.ts): если в выделении были обе
   * карточки связи И сама связь, сервер каскадно удалял связь вместе с первой
   * же удалённой карточкой в её батче, а второй батч с явным `edge.delete`
   * этой же связи получал «Связь не найдена» — необработанное исключение
   * (void-вызов без catch) плюс вводящий в заблуждение общий тост об ошибке
   * (реальных расхождений в состоянии при этом не было).
   *
   * Фикс — один общий батч: явный `edge.delete` шлём только для связей, ОБА
   * конца которых не входят в удаляемые карточки — такую связь сервер и так
   * удалит каскадом вместе с её карточкой в этом же батче.
   */
  function deleteSelection(): void {
    const deletedItemIds = new Set(selectedNodes.value.map((node) => node.id));
    const itemOps: BoardOp[] = selectedNodes.value.map((node) => ({
      type: 'item.delete',
      clientOpId: uuid(),
      id: node.id,
    }));
    const edgeOps: BoardOp[] = selectedEdges.value
      .filter((edge) => !deletedItemIds.has(edge.source) && !deletedItemIds.has(edge.target))
      .map((edge) => ({
        type: 'edge.delete',
        clientOpId: uuid(),
        id: edge.id,
      }));
    const ops = [...itemOps, ...edgeOps];
    if (ops.length) void options.applyOps(ops);
  }

  /* ----------------------- Выделение и контекстное меню ----------------------- */

  interface ContextMenuState {
    target: BoardContextMenuTarget;
    left: number;
    top: number;
  }

  const contextMenu = ref<ContextMenuState | null>(null);

  function contextMenuPositionFromEvent(event: MouseEvent | TouchEvent): {
    left: number;
    top: number;
  } {
    const rect = options.getCanvasRect();
    const point = event instanceof MouseEvent ? event : event.touches[0];
    if (!rect || !point) return { left: 0, top: 0 };
    return { left: point.clientX - rect.left, top: point.clientY - rect.top };
  }

  /**
   * Прямая мутация `.selected` на узлах/связях вместо `addSelectedNodes`/
   * `removeSelectedElements` из `useVueFlow()` (12.9) — на связке `:only-render-
   * visible-elements="true"` + собственный `setNodes`-синк эти хелперы иногда
   * уходят в ветку `multiSelectionActive`, которая только эмитит событие
   * `nodesChange`/`edgesChange`, ничего не мутируя сама — и в момент вызова
   * (например, сразу после программного клика в тестах) реального слушателя на
   * это событие не оказывается, снятие/установка выделения молча не срабатывает.
   * `node.selected`/`edge.selected` — обычные реактивные поля тех же объектов,
   * что рендерит Vue Flow — мутировать их напрямую надёжнее и не зависит от
   * этой внутренней ветки.
   */
  function selectOnlyNode(node: BoardSelectionNode): void {
    for (const n of options.getNodes()) n.selected = n.id === node.id;
    for (const e of options.getEdges()) e.selected = false;
  }

  function selectOnlyEdge(edge: BoardSelectionEdge): void {
    for (const n of options.getNodes()) n.selected = false;
    for (const e of options.getEdges()) e.selected = e.id === edge.id;
  }

  function selectAllElements(): void {
    for (const n of options.getNodes()) n.selected = true;
    for (const e of options.getEdges()) e.selected = true;
  }

  function clearAllSelection(): void {
    for (const n of options.getNodes()) n.selected = false;
    for (const e of options.getEdges()) e.selected = false;
  }

  /**
   * Клик по узлу-контейнеру (frame/group, 14.3), пока активен инструмент
   * создания элемента. Vue Flow гасит `pane-click` для клика по ЛЮБОМУ узлу —
   * фрейм визуально выглядит как пустая область мини-холста, но физически это
   * узел Vue Flow поверх пейна, так что обычный `onPaneClick` никогда не
   * сработал бы для клика ВНУТРИ уже существующего фрейма — элемент должен
   * приклеиться к нему автоматически (см. containerAt в Canvas).
   */
  function onNodeClick(args: { event: MouseEvent | TouchEvent; node: BoardSelectionNode }): void {
    if (options.activeTool() === 'select') return;
    if (!isBoardContainer(args.node.data.content.type)) return;
    if (!(args.event instanceof MouseEvent)) return;
    options.onContainerClick(args.event);
  }

  function onNodeContextMenu(args: {
    event: MouseEvent | TouchEvent;
    node: BoardSelectionNode;
  }): void {
    if (!options.canEdit()) return;
    args.event.preventDefault();
    // Правый клик по НЕвыделенной карточке заменяет выделение ей (как в Figma/Miro)
    if (!args.node.selected) selectOnlyNode(args.node);
    contextMenu.value = { target: 'item', ...contextMenuPositionFromEvent(args.event) };
  }

  /**
   * Правый клик по мульти-выделению (2+ узла) — Vue Flow поверх bounding box
   * выделения рисует служебную обёртку `.vue-flow__nodesselection-rect` (нужна
   * для группового драга/ресайза), которая физически перекрывает сами карточки.
   * Правый клик по НЕЙ не считается ни кликом по узлу, ни кликом по пейну —
   * `node-context-menu` не срабатывает вовсе, и без отдельного события браузерное
   * меню "просвечивало" вместо нашего (найдено вручную). У Vue Flow есть
   * отдельное событие именно под этот случай.
   */
  function onSelectionContextMenu(args: { event: MouseEvent | TouchEvent }): void {
    if (!options.canEdit()) return;
    args.event.preventDefault();
    contextMenu.value = { target: 'item', ...contextMenuPositionFromEvent(args.event) };
  }

  function onEdgeContextMenu(args: {
    event: MouseEvent | TouchEvent;
    edge: BoardSelectionEdge;
  }): void {
    if (!options.canEdit()) return;
    args.event.preventDefault();
    if (!args.edge.selected) selectOnlyEdge(args.edge);
    contextMenu.value = { target: 'edge', ...contextMenuPositionFromEvent(args.event) };
  }

  /** Пустой холст — своего меню нет, но браузерное всё равно гасим */
  function onPaneContextMenu(event: MouseEvent): void {
    event.preventDefault();
    contextMenu.value = null;
  }

  function closeContextMenu(): void {
    contextMenu.value = null;
  }

  return {
    selectedNodes,
    selectedEdges,
    selectionToolbarPosition,
    selectedForm,
    selectedColor,
    selectedFontSize,
    selectedFontSizeMode,
    canIncreaseSelectedFontSize,
    canDecreaseSelectedFontSize,
    selectedTextColor,
    selectedTextAlign,
    selectedActiveMarks,
    canGroupSelection,
    canUngroupSelection,
    contextMenu,
    effectiveFontSizeRegistry,
    selectOnlyNode,
    selectOnlyEdge,
    selectAllElements,
    clearAllSelection,
    onNodeClick,
    onNodeContextMenu,
    onSelectionContextMenu,
    onEdgeContextMenu,
    onPaneContextMenu,
    closeContextMenu,
    patchSelected,
    patchSelectedEdge,
    setSelectedForm,
    setSelectedColor,
    setSelectedFontSize,
    setSelectedFontSizeMode,
    setSelectedTextColor,
    setSelectedTextAlign,
    toggleSelectedMark,
    setSelectedHighlight,
    setSelectedEmoji,
    setSelectedSticker,
    setSelectedGiphy,
    setSelectedFrameSize,
    replaceSelectedImage,
    groupSelection,
    ungroupSelection,
    bringSelectedToFront,
    sendSelectedToBack,
    deleteSelected,
    deleteSelection,
    previewSelectedColor,
    cancelSelectedColorPreview,
    previewSelectedTextColor,
    cancelSelectedTextColorPreview,
  };
}
