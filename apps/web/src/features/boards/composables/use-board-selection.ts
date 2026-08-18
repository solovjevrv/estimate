import type {
  BoardColorHex,
  BoardItem,
  BoardItemContent,
  BoardItemPatchOp,
  BoardOp,
  BoardTextAlign,
  ReactionEmoji,
} from '@poker/shared';
import { isBoardContainer } from '@poker/shared';
import {
  FIT_FONT_MAX,
  getScaledFontSize,
  unscaleFontSizeStep,
} from '../../../lib/board/use-fit-font-size';
import { BOARD_ITEM_FONT_SIZE_MAX, BOARD_ITEM_FONT_SIZE_MIN } from '@poker/shared';
import { computed, ref, shallowRef } from 'vue';

import type { BoardEffectiveFontSizeRegistry } from '../board-canvas-keys';
import type { ItemFormKind } from '../board-item-form';
import type { BoardContextMenuTarget } from '../board-context-menu';
import {
  type BoardSelectionEdge,
  type BoardSelectionNode,
} from '../../../lib/board/vue-flow-adapter';
import { uuid } from '../../../lib/board/uuid';

export interface BoardSelectionOptions {
  canEdit: () => boolean;
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
  /** Размеры по умолчанию для текста/стикера/фигуры — вынесены в Canvas, чтобы
   * composable не зависел от board-item-defaults (см. комментарий ниже). */
  textDefaultDimensions: (content: BoardItemContent) => { width: number; height: number } | null;
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

  /** Плавающий тулбар над выделением узлов (12.6). */
  const selectionToolbarPosition = computed(() => {
    const selected = selectedNodes.value;
    if (!options.canEdit() || selected.length === 0) return null;
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

  function textDefaultDimensions(
    content: BoardItemContent,
  ): { width: number; height: number } | null {
    return options.textDefaultDimensions(content);
  }

  function selectedTextScale(node: BoardSelectionNode): number | null {
    const defaults = textDefaultDimensions(node.data.content);
    if (!defaults) return null;
    return Math.min(
      node.dimensions.width / defaults.width,
      node.dimensions.height / defaults.height,
    );
  }

  /** Сохранённый базовый размер — только для изменения +/- и его границ. */
  const selectedBaseFontSize = computed<number>(
    () => selectedNodes.value[0]?.data.style.fontSize ?? FIT_FONT_MAX,
  );

  /**
   * Тулбар показывает размер, который реально нарисовал node. Пока node ещё не
   * смонтирован, fallback применяет геометрическое масштабирование; после DOM-fit
   * registry заменяет его точным значением с учётом длины и форматирования текста.
   */
  const selectedFontSize = computed<number>(() => {
    const node = selectedNodes.value[0];
    if (!node) return FIT_FONT_MAX;
    const measured = fontSizeSizes.value.get(node.id);
    if (measured !== undefined) return measured;
    const defaults = textDefaultDimensions(node.data.content);
    if (!defaults) return selectedBaseFontSize.value;
    return getScaledFontSize(
      selectedBaseFontSize.value,
      node.dimensions.width,
      node.dimensions.height,
      defaults.width,
      defaults.height,
    );
  });
  const canIncreaseSelectedFontSize = computed(
    () => selectedBaseFontSize.value < BOARD_ITEM_FONT_SIZE_MAX,
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
    // Конвертация В картинку/эмодзи/стикер через общий пикер не поддерживается (нужен файл
    // или конкретный выбранный символ/пак) — у всех трёх свой отдельный путь создания/замены
    if (kind === 'image' || kind === 'emoji' || kind === 'sticker') return;
    // Фрейм/группа (14.3) — контейнеры, конвертировать их в другие типы или наоборот
    // через общий переключатель не поддерживается — они управляются отдельными действиями
    if (kind === 'frame' || kind === 'group') return;

    patchSelected((node) => {
      // Форматирование (12.13) переживает конвертацию стикер↔фигура↔текст вместе с текстом
      const content = node.data.content;
      let newContent: BoardItemContent;
      if (kind === 'sticky') {
        if (content.type === 'image' || content.type === 'emoji' || content.type === 'sticker') {
          // Конвертация из картинки/эмодзи/стикера — просто создаём пустой стикер
          newContent = { type: 'sticky', text: '' };
        } else if (content.type === 'frame' || content.type === 'group') {
          newContent = { type: 'sticky', text: '' };
        } else {
          const { text, runs } = content;
          newContent = { type: 'sticky', text, ...(runs?.length ? { runs } : {}) };
        }
      } else if (kind === 'text') {
        if (content.type === 'image' || content.type === 'emoji' || content.type === 'sticker') {
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
        if (content.type === 'image' || content.type === 'emoji' || content.type === 'sticker') {
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
   * Тулбар шагает по ОТОБРАЖАЕМОМУ (масштабированному) размеру шрифта, но
   * сохраняется базовый. При `scale` > шага стэппера `Math.round(targetFontSize /
   * scale)` откатывается обратно к `currentBase` (шаг в 2px displayed — меньше 1px
   * base) — клик по +/- молча ничего не менял бы, и оставался бы «залипшим», раз
   * при следующем клике currentBase/displayed те же самые. Гарантируем минимум
   * ±1 к базе в сторону клика, если точный пересчёт откатился к текущему значению.
   * Длинный текст может быть ужат ниже масштабированной базы. В таком случае
   * +/- меняет настройку пользователя на ту же дельту, а не понижает её до
   * fit-результата, который всё равно не поместится. Берём разницу displayed
   * с целевым fontSize (а не хардкодим шаг стэппера) — иначе значение молча
   * разойдётся с FONT_SIZE_STEP в BoardSelectionToolbar.vue при его смене.
   */
  function setSelectedFontSize(fontSize: number): void {
    const selected = selectedNodes.value[0];
    if (!selected) return;
    const defaults = textDefaultDimensions(selected.data.content);
    const scale = selectedTextScale(selected);
    const currentBase = selectedBaseFontSize.value;
    const displayed = selectedFontSize.value;
    const scaledBase =
      defaults === null
        ? currentBase
        : getScaledFontSize(
            currentBase,
            selected.dimensions.width,
            selected.dimensions.height,
            defaults.width,
            defaults.height,
          );

    const nextBase =
      scale === null || displayed !== scaledBase
        ? currentBase + (fontSize - displayed)
        : unscaleFontSizeStep(currentBase, fontSize, scale);
    const clampedBase = Math.min(
      BOARD_ITEM_FONT_SIZE_MAX,
      Math.max(BOARD_ITEM_FONT_SIZE_MIN, nextBase),
    );
    if (clampedBase === currentBase) return;
    patchSelected((node) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { style: { fontSize: clampedBase } },
    }));
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

  /** Смена эмодзи (13.3) — патчим content.emoji */
  /** Смена эмодзи (13.3) — как и замена картинки, не-эмодзи в смешанном выделении пропускаются */
  function setSelectedEmoji(emoji: ReactionEmoji): void {
    const ops: BoardOp[] = selectedNodes.value
      .filter((node) => node.data.content.type === 'emoji')
      .map((node) => ({
        type: 'item.patch',
        clientOpId: uuid(),
        id: node.id,
        patch: { content: { type: 'emoji', emoji } },
      }));
    if (ops.length) void options.applyOps(ops);
  }

  /** Смена стикера (13.4) — патчим content.pack и content.id, не-стикеры пропускаются */
  function setSelectedSticker(pack: string, id: string): void {
    const ops: BoardOp[] = selectedNodes.value
      .filter((node) => node.data.content.type === 'sticker')
      .map((node) => ({
        type: 'item.patch',
        clientOpId: uuid(),
        id: node.id,
        patch: { content: { type: 'sticker', pack, id } },
      }));
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
    for (const node of selectedNodes.value) {
      const parentId = node.data.parentId;
      if (parentId === null) continue;
      const parent = options.getItems().find((candidate) => candidate.id === parentId);
      if (parent?.content.type === 'group') {
        if (dissolvedGroupIds.has(parentId)) continue;
        dissolvedGroupIds.add(parentId);
        for (const member of childrenOf(parentId)) {
          ops.push({
            type: 'item.patch',
            clientOpId: uuid(),
            id: member.id,
            patch: { parentId: null },
          });
        }
        ops.push({ type: 'item.delete', clientOpId: uuid(), id: parentId });
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

  function bringSelectedToFront(): void {
    const base = options.getBoardZIndex().max + 1;
    patchSelected((node, index) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { zIndex: base + index },
    }));
  }

  function sendSelectedToBack(): void {
    const base = options.getBoardZIndex().min - selectedNodes.value.length;
    patchSelected((node, index) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { zIndex: base + index },
    }));
  }

  function deleteSelected(): void {
    patchSelected((node) => ({
      type: 'item.delete',
      clientOpId: uuid(),
      id: node.id,
    }));
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
    canIncreaseSelectedFontSize,
    canDecreaseSelectedFontSize,
    selectedTextColor,
    selectedTextAlign,
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
    setSelectedTextColor,
    setSelectedTextAlign,
    setSelectedEmoji,
    setSelectedSticker,
    replaceSelectedImage,
    groupSelection,
    ungroupSelection,
    bringSelectedToFront,
    sendSelectedToBack,
    deleteSelected,
    previewSelectedColor,
    cancelSelectedColorPreview,
    previewSelectedTextColor,
    cancelSelectedTextColorPreview,
  };
}
