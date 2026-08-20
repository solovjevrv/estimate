<script setup lang="ts">
/**
 * Холст доски поверх Vue Flow. Раскладка управления по Miro: колесо — пан,
 * Ctrl/Cmd+колесо и пинч — зум, средняя кнопка мыши или зажатый пробел+ЛКМ —
 * пан, drag по пустому холсту ЛКМ — рамка мультивыбора (12.5).
 *
 * Создание/перетаскивание/резайз/редактирование/цвет/слои/удаление стикеров —
 * 12.6, с оптимистичным применением через `stores/board-session.ts`. Фигуры
 * (12.7) переиспользуют ту же механику — новый тип элемента = новый компонент
 * рендера (`BoardShapeNode.vue`), без изменений протокола/стора. Создать
 * можно двумя жестами (оба из макета): двойной клик по холсту в любой момент
 * (всегда создаёт стикер — самый частый случай), или выбрать инструмент
 * «Стикер»/«Фигура» в левом тулбаре — следующий одиночный клик по холсту
 * создаёт элемент там и возвращает инструмент обратно на «Выделение». Тип
 * элемента (стикер/прямоугольник/скруглённый/эллипс/ромб) можно сменить и
 * ПОСЛЕ создания — единый дропдаун в плавающем тулбаре выделения конвертирует
 * стикер в фигуру и обратно, сохраняя текст (решение пользователя). Цвет —
 * не 7 токенов, а свободный hex: попап с палитрой из 12.7-макета плюс
 * кастомный цвет через `UColorPicker` (18.3 — замена нативного
 * `<input type="color">`, чей попап закрывался нестабильно).
 *
 * Визуальный язык — по референсу `.design/main.html` (экран "Доска"). Из
 * референса сознательно НЕ взяты: 2 оставшиеся иконки левого тулбара
 * (текст/картинка/эмодзи — 13.х, ещё не реализованы).
 *
 * 12.9: контекстное меню по правой кнопке (`BoardContextMenu.vue`) — слои
 * (вперёд/назад) и дублирование теперь там, а не в тулбаре выделения; хоткеи
 * (`use-board-hotkeys.ts`) — Delete/Backspace, Ctrl(Cmd)+A/D/0/1, Escape,
 * Shift+drag по одной оси; размер/шрифт/цвет/выравнивание текста — в
 * `BoardSelectionToolbar.vue`; инструмент «Стрелка» в левом тулбаре —
 * affordance поверх уже рабочего drag-от-хендла (см. `onConnect` ниже).
 */
import {
  BOARD_OPS_BATCH_MAX,
  type Board,
  type BoardEdge,
  type BoardItem,
  type BoardItemContent,
} from '@poker/shared';
import type { DropdownMenuItem } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { Background } from '@vue-flow/background';
import { ControlButton, Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import {
  ConnectionMode,
  Panel,
  useVueFlow,
  VueFlow,
  type GraphNode,
  type NodeDragEvent,
  type NodeMouseEvent,
} from '@vue-flow/core';
import {
  computed,
  markRaw,
  onBeforeUnmount,
  onMounted,
  provide,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';

import {
  maxZIndex,
  minZIndex,
  resolveEdgeColor,
  SHAPE_DEFAULT_HEIGHT,
  SHAPE_DEFAULT_WIDTH,
  STICKY_DEFAULT_COLOR,
  STICKY_DEFAULT_HEIGHT,
  STICKY_DEFAULT_WIDTH,
  TEXT_DEFAULT_HEIGHT,
  TEXT_DEFAULT_WIDTH,
} from '../../features/boards/config/board-item-defaults';
import {
  BOARD_ACTIVE_TEXT_EDITOR_KEY,
  BOARD_CAN_EDIT_KEY,
  BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY,
  BOARD_PENDING_EDGE_EDIT_ID_KEY,
  BOARD_PENDING_EDIT_ID_KEY,
} from '../../features/boards/context/board-canvas-keys';
import { readableTextColor } from '../../features/boards/domain/board-colors';
import type { BoardTextEditorHandle } from '../../features/boards/rich-text/board-rich-text';
import { useBoardHotkeys } from '../../features/boards/composables/use-board-hotkeys';
import type {
  BoardDragEvent,
  BoardDragNode,
  BoardFlowEdge,
  BoardFlowNode,
  BoardSelectionEdge,
  BoardSelectionNode,
} from '../../features/boards/adapters/vue-flow-adapter';
import { toFlowEdges, toFlowNodes } from '../../features/boards/adapters/vue-flow-adapter';
import { useBoardSessionStore } from '../../stores/board-session';
import { useBoardClipboard } from '../../features/boards/composables/use-board-clipboard';
import { useBoardCreation } from '../../features/boards/composables/use-board-creation';
import { useBoardDragAndSnap } from '../../features/boards/composables/use-board-drag-and-snap';
import { useBoardEdges } from '../../features/boards/composables/use-board-edges';
import { useBoardSelection } from '../../features/boards/composables/use-board-selection';
import { useBoardViewport } from '../../features/boards/composables/use-board-viewport';
import BoardSelectionToolbar from './BoardSelectionToolbar.vue';
import BoardContextMenu from './BoardContextMenu.vue';
import BoardCursor from './BoardCursor.vue';
import BoardEdgeToolbar from './BoardEdgeToolbar.vue';
import BoardFloatingEdge from './BoardFloatingEdge.vue';
import BoardImageNode from './BoardImageNode.vue';
import BoardShapeNode from './BoardShapeNode.vue';
import BoardSnapGuides from './BoardSnapGuides.vue';
import BoardStickyNode from './BoardStickyNode.vue';
import BoardTextNode from './BoardTextNode.vue';
import BoardEmojiNode from './BoardEmojiNode.vue';
import BoardStickerNode from './BoardStickerNode.vue';
import BoardToolbar from './BoardToolbar.vue';
import BoardFrameNode from './BoardFrameNode.vue';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';
import '@vue-flow/node-resizer/dist/style.css';

const props = defineProps<{
  board: Board;
  /** Название команды — только для командной доски, для подписи "Командная доска · Team" */
  teamName?: string | null;
  canManage: boolean;
  /** Может редактировать содержимое (уровень доступа `edit` из 12.4) — участник/админ команды, не гость */
  canEdit: boolean;
  items: BoardItem[];
  edges: BoardEdge[];
}>();

const emit = defineEmits<{
  rename: [];
  archive: [];
  unarchive: [];
  delete: [];
  share: [];
}>();

const { t } = useI18n();
const toast = useToast();
const boardSession = useBoardSessionStore();

const flowNodes = computed(() => toFlowNodes(props.items, props.canEdit));
const flowEdges = computed(() => toFlowEdges(props.edges));

// markRaw — иначе Vue оборачивает объект с компонентами в reactive() и предупреждает
// об этом в консоли (компонент-конструктор реактивным быть не должен)
const nodeTypes = markRaw({
  sticky: BoardStickyNode,
  shape: BoardShapeNode,
  text: BoardTextNode,
  image: BoardImageNode,
  emoji: BoardEmojiNode,
  sticker: BoardStickerNode,
  // Фрейм и группа (14.3) — один и тот же компонент, различаются content.type
  frame: BoardFrameNode,
  group: BoardFrameNode,
});
// Единственный тип связи — геометрия floating edge не зависит от типа линии
// (12.8), тип линии/маркеры читаются самим компонентом из data.style
const edgeTypes = markRaw({ floating: BoardFloatingEdge });

const isArchived = computed(() => props.board.status === 'archived');

// Пункты меню зависят от статуса архивации — те же действия, что раньше были
// отдельными кнопками над холстом (12.3), теперь под общим "..." (12.5). Две
// группы (разделитель между ними рисует сам UDropdownMenu) — деструктивное
// действие отделено от обычного и покрашено в error, как в референсе
const menuItems = computed<DropdownMenuItem[][]>(() =>
  isArchived.value
    ? [
        [
          {
            label: t('board.unarchive'),
            icon: 'i-lucide-rotate-ccw',
            onSelect: () => emit('unarchive'),
          },
        ],
        [
          {
            label: t('board.deleteBoard'),
            icon: 'i-lucide-trash-2',
            color: 'error',
            onSelect: () => emit('delete'),
          },
        ],
      ]
    : [
        [{ label: t('board.rename'), icon: 'i-lucide-pencil', onSelect: () => emit('rename') }],
        [
          {
            label: t('board.share'),
            icon: 'i-lucide-share-2',
            onSelect: () => emit('share'),
          },
        ],
        [
          {
            label: t('board.archive'),
            icon: 'i-lucide-archive',
            color: 'error',
            onSelect: () => emit('archive'),
          },
        ],
      ],
);

const subtitle = computed(() =>
  props.board.teamId
    ? props.teamName
      ? `${t('board.teamBoardSubtitle')} · ${props.teamName}`
      : t('board.teamBoardSubtitle')
    : t('board.personalBoardSubtitle'),
);

const {
  viewport,
  project,
  getSelectedNodes,
  getSelectedEdges,
  getNodes,
  getEdges,
  setNodes,
  setEdges,
  addSelectedNodes,
  removeSelectedNodes,
  setViewport,
  zoomTo,
  fitView,
} = useVueFlow();

const rootEl = useTemplateRef<HTMLElement>('root');

/**
 * Управление viewport, fullscreen, follow-mode и cursor/camera awareness
 * вынесено в `useBoardViewport` (19.31). Обёртка над Vue Flow передаётся
 * коллбэками — composable не импортирует @vue-flow/core. `boardSession`
 * пробрасывается «наружу» через замыкания; реактивные refs follow/camera
 * оборачиваются `computed`, т.к. Pinia auto-unwrapит состояние/геттеры в
 * значения при доступе через прокси стора.
 */
const viewportControl = useBoardViewport({
  canEdit: () => props.canEdit,
  rootEl,
  viewport,
  project,
  setViewport,
  zoomTo,
  fitView,
  sendAwareness: (kind, data) => boardSession.sendAwareness(kind, data),
  participantId: () => boardSession.participantId,
  presence: () => boardSession.presence,
  followedParticipantId: computed(() => boardSession.followedParticipantId),
  cameraOfFollowed: computed(() => boardSession.cameraOfFollowed),
  followParticipant: boardSession.followParticipant,
  stopFollowing: boardSession.stopFollowing,
});

const {
  zoomPercent,
  isFullscreen,
  followedName,
  cursorThrottler,
  onManualCameraInteraction,
  onPresenceAvatarClick,
  breakFollowOnEdit,
  resetZoom,
  fitViewport,
  toggleFullscreen,
  initials,
} = viewportControl;

/**
 * Скармливаем снимок Vue Flow императивно через `setNodes`/`setEdges`, а не
 * биндингом `:nodes`/`:edges` — Vue 3.4+ трактует их как двусторонние модели
 * (`useModel`), и после первой же внутренней записи без слушателя (например,
 * перетаскивания узла) их локальное значение перестаёт следовать за нашим
 * пропом: обновления от других участников по WS переставали доходить до
 * холста после того, как сам пользователь хоть раз что-то перетащил —
 * подтверждено вручную (Playwright, два браузерных контекста). `setNodes`
 * мержит по id через внутренний `parseNode` и не трогает `selected`/`dragging`
 * полей, которых нет в наших плоских объектах, так что выделение/резайз/драг
 * этим не задевает.
 *
 * Позицию (`position`) при мерже `setNodes` ВСЁ ЖЕ перезаписывает — при драге
 * ГРУППЫ узлов (13.5) это дёргало элементы: троттлед-патчи по разным узлам
 * долетают до стора не одновременно, и как только позиция одного узла в
 * сторе обновляется (оптимистично, ещё до ответа сервера — см. `applyOps`),
 * `flowNodes` пересчитывается и этот watcher применяет `setNodes(next)` для
 * ВСЕХ узлов сразу — для остальных, ещё не долетевших до стора, это откатывало
 * бы их позицию к додраговой поверх текущего живого перетаскивания. Пока
 * `dragIsDragging` — `true`, сам пользователь тащит группу локально,
 * пропускаем применение снимка; на `dragStop` ref синхронно сбрасывается в
 * `false`, и следующий реактивный проход применяется как обычно с согласованными
 * позициями. Другие участники, кто-то другой двигает карточку параллельно —
 * тот кейс уже отдельно проверен (см. абзац выше), это не задевается.
 *
 * Состояние drag/snap (стартовые позиции, throttlers, направляющие) вынесено в
 * `useBoardDragAndSnap` (19.30) — Canvas лишь читает `isDragging` чтобы не
 * наложить `setNodes(flowNodes)` поверх локального drag.
 */
const dragAndSnap = useBoardDragAndSnap({
  canEdit: () => props.canEdit,
  getItems: () => props.items,
  getNodes: () => getNodes.value as BoardDragNode[],
  getZoom: () => viewport.value.zoom,
  applyOps: (ops, options) => void boardSession.applyOps(ops, options),
  breakFollowOnEdit,
  findFrameAt: containerAt,
});

// Деструктурируем ref-ы на верхний уровень: Vue 3 автораспаковывает ref,
// объявленный как top-level const в <script setup>, в шаблоне без .value.
const { activeSnapGuides, isDragging: dragIsDragging } = dragAndSnap;

watch(
  flowNodes,
  (next) => {
    if (dragIsDragging.value) return;
    setNodes(next);
  },
  { immediate: true },
);
watch(flowEdges, (next) => setEdges(next), { immediate: true });

const {
  activeTool,
  pendingEditId,
  canCreateItems,
  canCreateItem,
  pickImageFile,
  uploadImage,
  createImage,
  createEmojiAtCenter,
  createStickerAtCenter,
  cancelPendingEdit,
  onPaneClick: onPaneClickForCreation,
  onPaneDoubleClick,
  onPaneDrop,
} = useBoardCreation({
  boardId: () => props.board.id,
  canEdit: () => props.canEdit,
  getItems: () => props.items,
  getCanvasRect: () => rootEl.value?.getBoundingClientRect(),
  project,
  findContainerAt: containerAt,
  applyOps: (ops) => void boardSession.applyOps(ops),
  breakFollowOnEdit,
});

const {
  copy: onCopy,
  paste: onPaste,
  duplicateSelection: duplicateSelected,
} = useBoardClipboard({
  canEdit: () => props.canEdit,
  getItems: () => props.items,
  getEdges: () => props.edges,
  getSelectedNodes: () => getSelectedNodes.value,
  getCanvasRect: () => rootEl.value?.getBoundingClientRect(),
  project,
  findContainerAt: (point) => containerAt(point),
  canCreateItems,
  canApplyOpsCount,
  uploadImage,
  createImage,
  applyOps: (ops) => void boardSession.applyOps(ops),
  breakFollowOnEdit,
  clearSelection: () => removeSelectedNodes(getSelectedNodes.value),
  selectItems: (ids) => addSelectedNodes(ids.map((id) => ({ id }) as GraphNode<BoardItem>)),
});

// useBoardSelection деструктурируется сразу — шаблон обращается к полям через
// локальные имена (selectionToolbarPosition, selectedForm, contextMenu и т.п.),
// а события Vue Flow (node-click и т.д.) — к методам `selection.*`.
const selection = useBoardSelection({
  canEdit: () => props.canEdit,
  getItems: () => props.items,
  getEdges: () => getEdges.value as BoardSelectionEdge[],
  getNodes: () => getNodes.value as BoardSelectionNode[],
  getCanvasRect: () => rootEl.value?.getBoundingClientRect(),
  getViewport: () => viewport.value,
  getSelectedNodes: () => getSelectedNodes.value as BoardSelectionNode[],
  getSelectedEdges: () => getSelectedEdges.value as BoardSelectionEdge[],
  applyOps: (ops) => void boardSession.applyOps(ops),
  canCreateItem,
  onContainerClick: onPaneClick,
  pickImageFile,
  uploadImage,
  activeTool: () => activeTool.value,
  breakFollowOnEdit,
  textDefaultDimensions,
  // Сохраняем прежнюю baseline-семантику: максимум не ниже 0, минимум не выше 0.
  // Иначе при доске только с отрицательными (или положительными) z-index действие
  // «на передний/задний план» меняло бы поведение после выноса в composable.
  getBoardZIndex: () => ({ max: maxZIndex(props.items), min: minZIndex(props.items) }),
  defaultItemColor: STICKY_DEFAULT_COLOR,
  resolveTextColor: readableTextColor,
});

// Вынесенные в composable состояние и методы, которыми пользуется шаблон.
// Computed-свойства и методы деструктурируются как есть — Vue 3 автораспаковывает
// ref/computed в шаблонах для top-level констант <script setup>. Логика связей
// (create/patch/label) вынесена в `useBoardEdges` (19.32) — Canvas лишь пробрасывает
// состояние и методы в шаблон через `edges`.
const {
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
  onNodeContextMenu,
  onSelectionContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
  closeContextMenu,
  setSelectedColor,
  setSelectedForm,
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
} = selection;

/**
 * Управление связями (12.8–12.9) — создание edge.create, форматирование стиля,
 * live-preview цвета и открытие редактора подписи. Вынесено из Canvas/selection
 * в отдельный composable (19.32); Canvas пробрасывает только адаптерные callbacks
 * и потребляет `pendingEdgeEditId` через provide (см. ниже).
 */
const edges = useBoardEdges({
  canEdit: () => props.canEdit,
  getNodes: () => getNodes.value as BoardFlowNode[],
  getEdges: () => getEdges.value as BoardFlowEdge[],
  getSelectedEdges: () => getSelectedEdges.value as BoardFlowEdge[],
  getViewport: () => viewport.value,
  applyOps: (ops) => void boardSession.applyOps(ops),
  activeTool: () => activeTool.value,
  setActiveTool: (tool) => {
    activeTool.value = tool as typeof activeTool.value;
  },
  resolveEdgeColor,
  breakFollowOnEdit,
});

const {
  edgeToolbarPosition,
  selectedEdgeStyle,
  selectedEdgeColor,
  selectedEdgeLabelFontSize,
  selectedEdgeLabelTextAlign,
  selectedEdgeLabelTextColor,
  selectedEdgeLabelBold,
  selectedEdgeLabelItalic,
  selectedEdgeLabelUnderline,
  selectedEdgeLabelStrike,
  addTextToSelectedEdge,
  deleteSelectedEdges,
  patchEdgeLine,
  patchEdgeDash,
  patchEdgeMarkerStart,
  patchEdgeMarkerEnd,
  patchEdgeColor,
  previewEdgeColor,
  cancelEdgeColorPreview,
  patchEdgeLabelFontSize,
  patchEdgeLabelTextAlign,
  patchEdgeLabelTextColor,
  patchEdgeLabelBold,
  patchEdgeLabelItalic,
  patchEdgeLabelUnderline,
  patchEdgeLabelStrike,
} = edges;

/**
 * Управление viewport, fullscreen, follow-mode и cursor/camera awareness
 * вынесено в `useBoardViewport` (19.31) — Canvas лишь деструктурирует нужное
 * из `viewportControl` и пробрасывает в шаблон (см. выше).
 */

// `onCopy` асинхронная (сериализация картинок читает байты), а слушатель события
// ждёт синхронную функцию: отданный ему промис никто не подхватывает, и отказ
// внутри стал бы необработанным. Оборачиваем один раз — ссылка нужна той же
// самой, иначе removeEventListener ниже не снимет обработчик.
const onCopyListener = (event: ClipboardEvent): void => {
  void onCopy(event);
};

onMounted(() => {
  viewportControl.attach();
  document.addEventListener('paste', onPaste);
  document.addEventListener('copy', onCopyListener);
  // Vue Flow renders `.vue-flow__pane` and `.vue-flow__transformationpane` internally —
  // we can't attach attrs from the template, so set data-testid imperatively
  // for e2e selectors.
  const pane = rootEl.value?.querySelector('.vue-flow__pane');
  if (pane) pane.setAttribute('data-testid', 'board-pane');
  const viewportEl = rootEl.value?.querySelector('.vue-flow__transformationpane');
  if (viewportEl) viewportEl.setAttribute('data-testid', 'board-viewport');
});
onBeforeUnmount(() => {
  viewportControl.dispose();
  document.removeEventListener('paste', onPaste);
  document.removeEventListener('copy', onCopyListener);
  dragAndSnap.reset();
});

/**
 * `BoardPage.vue` переиспользует один и тот же `BoardCanvas` при смене доски
 * (меняет пропы, не размонтирует компонент), так что без явной очистки записи
 * от уже покинутой доски (в т.ч. trailing throttles) продолжали бы висеть в
 * памяти всю сессию страницы. Состояние — в composable, а не в локальном Map.
 */
watch(
  () => props.board.id,
  () => {
    dragAndSnap.reset();
    viewportControl.resetAwareness();
  },
);

// --- Инструменты и создание стикеров (12.6) ---
// activeTool и pendingEditId пришли из useBoardCreation (см. выше), здесь
// только provide для потребителей через контекст доски.

/** Id связи, подпись которой нужно открыть для ввода текста прямо на стрелке (12.8) */
provide(
  BOARD_CAN_EDIT_KEY,
  computed(() => props.canEdit),
);
provide(BOARD_PENDING_EDIT_ID_KEY, pendingEditId);
provide(BOARD_PENDING_EDGE_EDIT_ID_KEY, edges.pendingEdgeEditId);
/**
 * Хэндл узла, сейчас редактирующего текст (12.13) — публикует его сам узел,
 * см. `board-rich-text.ts`. `shallowRef`, не `ref` — иначе Vue своим
 * `UnwrapRef` рекурсивно распаковал бы вложенный `activeMarks: Ref<...>`
 * внутри хэндла до голого значения, ломая типы и реактивность самого поля.
 */
const activeTextEditor = shallowRef<BoardTextEditorHandle | null>(null);
provide(BOARD_ACTIVE_TEXT_EDITOR_KEY, activeTextEditor);

/** Клик по пустому холсту завершает ввод текста до обработки выбранного инструмента. */
function onPaneClick(event: MouseEvent): void {
  cancelPendingEdit();
  activeTextEditor.value?.commit();
  onPaneClickForCreation(event);
}

/** Клик по существующему узлу отменяет не потреблённый автопереход перед передачей в selection. */
function onNodeClick(event: NodeMouseEvent): void {
  cancelPendingEdit();
  selection.onNodeClick(event);
}

// effectiveFontSizeRegistry принадлежит composable (жизненный цикл совпадает с
// холстом); Canvas только пробрасывает его через provide для измерения node-ами.
provide(BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY, selection.effectiveFontSizeRegistry);

/* canCreateItems/canCreateItem вынесены в useBoardCreation. Canvas сохраняет
 * canApplyOpsCount — он про батч-лимит WS, а не про создание элемента. */

/**
 * Батч WS `board:apply` ограничен BOARD_OPS_BATCH_MAX операций за раз (12.1) —
 * копирование/дублирование теперь может слать item.create + edge.create в
 * одном батче, так что при насыщенной схеме (много карточек и связей) лимит
 * можно превысить даже при небольшом числе items. Без этой проверки батч
 * молча отклонился бы сервером целиком (ничего не вставилось бы).
 */
function canApplyOpsCount(count: number): boolean {
  if (count > BOARD_OPS_BATCH_MAX) {
    toast.add({ title: t('board.tooManyOpsAtOnce'), color: 'error' });
    return false;
  }
  return true;
}

/**
 * Вмешательство в работу: если пользователь сейчас следует за чужой камерой,
 * любое действие по редактированию доски (создание, перемещение, ввод текста)
 * должно снять режим слежения — иначе объект будет «улетать» за чужой viewport.
 * Действие возможно только при canEdit — у read-only гостя слежение не
 * нарушается (он не может вмешаться). Логика вынесена в
 * `useBoardViewport#breakFollowOnEdit` (19.31).
 */

/**
 * ФРЕЙМ (не группа!), в чьи границы попадает точка — фрейм задуман как
 * мини-холст (референс Miro): всё, что создаётся или перетаскивается внутрь
 * его границ, сразу становится его содержимым (`parentId`), а не лежит
 * поверх него отдельным несвязанным элементом. Группа сюда сознательно НЕ
 * попадает — она невидима, у нёё нет заметных пользователю границ, чтобы
 * целиться, и в отличие от фрейма членство в ней меняется только явным
 * действием «Группировать»/«Разгруппировать», а не геометрией драга — иначе
 * элемент мог бы "случайно" прилипнуть к чьей-то невидимой старой группе
 * просто оказавшись над её bounding box (запутывающий баг, найденный вручную).
 * Если точка попадает сразу в несколько перекрывающихся фреймов — берём
 * наименьший по площади (обычно самый "внутренний" визуально). `excludeId` —
 * не рассматривать сам себя (при перетаскивании фрейма он не должен
 * попытаться стать своим же родителем).
 */
function containerAt(point: { x: number; y: number }, excludeId?: string): BoardItem | undefined {
  let best: BoardItem | undefined;
  let bestArea = Infinity;
  for (const candidate of props.items) {
    if (candidate.id === excludeId) continue;
    if (candidate.content.type !== 'frame') continue;
    if (
      point.x < candidate.x ||
      point.x > candidate.x + candidate.width ||
      point.y < candidate.y ||
      point.y > candidate.y + candidate.height
    ) {
      continue;
    }
    const area = candidate.width * candidate.height;
    if (area < bestArea) {
      best = candidate;
      bestArea = area;
    }
  }
  return best;
}

/** Drag over — нужен, чтобы браузер разрешил drop */
function onPaneDragOver(event: DragEvent): void {
  if (!props.canEdit) return;
  event.preventDefault();
  // Визуальная индикация (опционально) — можно добавить класс на rootEl
}

// --- Перетаскивание элементов, cascade frame/group, snap-направляющие (12.6, 13.6, 14.3) ---
// Вся drag-логика вынесена в composable: локально холст двигает сам Vue Flow,
// по сети — throttled-патчи на каждый кадр драга плюс гарантированный финальный
// на dragstop. Троттлер свой на элемент — иначе при мультивыборе только
// последний по порядку элемент кадра реально долетал бы до сети.
/**
 * Адаптер границы: Vue Flow проталкивает реальный `NodeDragEvent` в template-
 * обработчики Canvas, а composable `useBoardDragAndSnap` работает с абстрактным
 * `BoardDragEvent` (без импорта `@vue-flow/core`). Здесь — единственное место,
 * где тип Vue Flow встречается с доменной drag/snap-логикой.
 */
function toBoardDragEvent(event: NodeDragEvent): BoardDragEvent {
  return {
    event: event.event,
    nodes: event.nodes as BoardDragNode[],
  };
}

function onNodeDragStart(event: NodeDragEvent): void {
  dragAndSnap.onNodeDragStart(toBoardDragEvent(event));
}

/**
 * Локальный wrapper над composable onNodeDrag: во время драга узла реальный
 * mousemove на пейне не долетает до cursorThrottler (указатель перехвачен
 * драгом Vue Flow), поэтому прокидываем событие вручную.
 */
function onNodeDrag(event: NodeDragEvent): void {
  dragAndSnap.onNodeDrag(toBoardDragEvent(event));
  if (event.event instanceof MouseEvent) cursorThrottler(event.event);
}

function onNodeDragStop(event: NodeDragEvent): void {
  dragAndSnap.onNodeDragStop(toBoardDragEvent(event));
}

function textDefaultDimensions(
  content: BoardItemContent,
): { width: number; height: number } | null {
  switch (content.type) {
    case 'sticky':
      return { width: STICKY_DEFAULT_WIDTH, height: STICKY_DEFAULT_HEIGHT };
    case 'shape':
      return { width: SHAPE_DEFAULT_WIDTH, height: SHAPE_DEFAULT_HEIGHT };
    case 'text':
      return { width: TEXT_DEFAULT_WIDTH, height: TEXT_DEFAULT_HEIGHT };
    default:
      return null;
  }
}

// --- Хоткеи (12.9): Delete/Backspace, Ctrl(Cmd)+A/D/0/1, Escape; +Z/Shift+Z/Y (12.10) ---

useBoardHotkeys({
  canEdit: computed(() => props.canEdit),
  deleteSelection: () => {
    selection.deleteSelected();
    edges.deleteSelectedEdges();
  },
  duplicateSelection: duplicateSelected,
  selectAll: selection.selectAllElements,
  clearSelection: () => {
    selection.clearAllSelection();
    selection.closeContextMenu();
  },
  resetZoom: resetZoom,
  fitView: fitViewport,
  undo: () => void boardSession.undo(),
  redo: () => void boardSession.redo(),
});
</script>

<template>
  <div
    ref="root"
    data-testid="board-canvas"
    :data-board-joined="boardSession.joined ? 'true' : 'false'"
    :data-board-revision="boardSession.revision"
    class="board-canvas-root h-full w-full bg-[var(--ui-bg)]"
    :class="{
      'board-canvas-tool-armed': activeTool !== 'select',
      'board-canvas-tool-armed-arrow': activeTool === 'arrow',
    }"
    @dblclick.capture="onPaneDoubleClick"
    @drop="onPaneDrop"
    @dragover="onPaneDragOver"
  >
    <VueFlow
      data-testid="board-flow"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :nodes-draggable="canEdit"
      :nodes-connectable="canEdit"
      :connection-mode="ConnectionMode.Loose"
      :connection-radius="40"
      :pan-on-drag="[1]"
      :selection-key-code="true"
      :pan-on-scroll="true"
      :zoom-on-scroll="false"
      :zoom-on-pinch="true"
      :min-zoom="0.1"
      :max-zoom="2"
      :only-render-visible-elements="true"
      fit-view-on-init
      :delete-key-code="null"
      :elevate-nodes-on-select="false"
      @connect="edges.onConnect"
      @pane-click="onPaneClick"
      @pane-context-menu="onPaneContextMenu"
      @move-start="onManualCameraInteraction"
      @mousemove="cursorThrottler"
      @node-drag-start="onNodeDragStart"
      @node-drag="onNodeDrag"
      @node-drag-stop="onNodeDragStop"
      @node-click="onNodeClick"
      @node-context-menu="onNodeContextMenu"
      @selection-context-menu="onSelectionContextMenu"
      @edge-double-click="edges.onEdgeDoubleClick"
      @edge-context-menu="onEdgeContextMenu"
    >
      <Background pattern-color="var(--brand-border)" :gap="22" variant="dots" />
      <MiniMap
        class="board-minimap"
        pannable
        zoomable
        :width="180"
        :height="120"
        mask-color="color-mix(in oklch, var(--brand-ink) 12%, transparent)"
        mask-stroke-color="var(--ui-primary)"
        :mask-stroke-width="2"
      />

      <BoardSnapGuides
        v-if="activeSnapGuides.length"
        :guides="activeSnapGuides"
        :viewport-x="viewport.x"
        :viewport-y="viewport.y"
        :viewport-zoom="viewport.zoom"
      />
      <BoardToolbar
        v-if="canEdit"
        v-model="activeTool"
        @emoji="createEmojiAtCenter"
        @sticker="createStickerAtCenter"
      />

      <BoardSelectionToolbar
        v-if="selectionToolbarPosition"
        :left="selectionToolbarPosition.left"
        :top="selectionToolbarPosition.top"
        :current-color="selectedColor"
        :current-form="selectedForm"
        :current-font-size="selectedFontSize"
        :can-increase-font-size="canIncreaseSelectedFontSize"
        :can-decrease-font-size="canDecreaseSelectedFontSize"
        :current-text-color="selectedTextColor"
        :current-text-align="selectedTextAlign"
        :editing-text="!!activeTextEditor"
        :active-marks="activeTextEditor?.activeMarks.value ?? null"
        :has-text-selection="activeTextEditor?.hasTextSelection.value ?? false"
        @color="setSelectedColor"
        @color-preview="previewSelectedColor"
        @color-cancel="cancelSelectedColorPreview"
        @form="setSelectedForm"
        @font-size="setSelectedFontSize"
        @text-color="setSelectedTextColor"
        @text-color-preview="previewSelectedTextColor"
        @text-color-cancel="cancelSelectedTextColorPreview"
        @text-align="setSelectedTextAlign"
        @toggle-mark="activeTextEditor?.toggle($event)"
        @set-highlight="activeTextEditor?.setHighlight($event)"
        @set-link="activeTextEditor?.setLink($event)"
        @duplicate="duplicateSelected"
        @delete="deleteSelected"
        @replace-image="replaceSelectedImage"
        @emoji="setSelectedEmoji"
        @sticker="setSelectedSticker"
      />

      <BoardEdgeToolbar
        v-if="edgeToolbarPosition"
        :left="edgeToolbarPosition.left"
        :top="edgeToolbarPosition.top"
        :current-line="selectedEdgeStyle.line"
        :current-dash="selectedEdgeStyle.dash"
        :current-marker-start="selectedEdgeStyle.markerStart"
        :current-marker-end="selectedEdgeStyle.markerEnd"
        :current-color="selectedEdgeColor"
        :current-label-font-size="selectedEdgeLabelFontSize"
        :current-label-text-align="selectedEdgeLabelTextAlign"
        :current-label-text-color="selectedEdgeLabelTextColor"
        :current-label-bold="selectedEdgeLabelBold"
        :current-label-italic="selectedEdgeLabelItalic"
        :current-label-underline="selectedEdgeLabelUnderline"
        :current-label-strike="selectedEdgeLabelStrike"
        @line="patchEdgeLine"
        @dash="patchEdgeDash"
        @marker-start="patchEdgeMarkerStart"
        @marker-end="patchEdgeMarkerEnd"
        @color="patchEdgeColor"
        @color-preview="previewEdgeColor"
        @color-cancel="cancelEdgeColorPreview"
        @label-font-size="patchEdgeLabelFontSize"
        @label-text-align="patchEdgeLabelTextAlign"
        @label-bold="patchEdgeLabelBold"
        @label-italic="patchEdgeLabelItalic"
        @label-underline="patchEdgeLabelUnderline"
        @label-strike="patchEdgeLabelStrike"
        @label-text-color="patchEdgeLabelTextColor"
        @add-text="addTextToSelectedEdge"
        @delete="deleteSelectedEdges"
      />

      <BoardContextMenu
        v-if="contextMenu"
        :left="contextMenu.left"
        :top="contextMenu.top"
        :target="contextMenu.target"
        :can-group="canGroupSelection"
        :can-ungroup="canUngroupSelection"
        @bring-to-front="bringSelectedToFront"
        @send-to-back="sendSelectedToBack"
        @duplicate="duplicateSelected"
        @group="groupSelection"
        @ungroup="ungroupSelection"
        @add-text="edges.addTextToSelectedEdge"
        @delete="contextMenu.target === 'item' ? deleteSelected() : edges.deleteSelectedEdges()"
        @close="closeContextMenu"
      />

      <div v-if="items.length === 0" class="board-empty-state">
        <UIcon name="i-lucide-sticky-note" class="text-muted size-12" />
        <div class="font-heading text-lg font-extrabold">{{ t('board.emptyTitle') }}</div>
        <div v-if="canEdit" class="text-muted max-w-[320px] text-center text-sm leading-relaxed">
          {{ t('board.emptyHint') }}
        </div>
      </div>

      <!-- Плашка с названием доски поверх холста, как в Miro — не в потоке страницы (12.5) -->
      <Panel position="top-left">
        <div class="surface-card flex items-center gap-3.5 py-3.5 pr-2.5 pl-[18px]">
          <div class="flex min-w-0 flex-col">
            <RouterLink
              :to="{ name: 'boards' }"
              class="text-muted hover:text-highlighted w-fit text-xs font-semibold"
            >
              ← {{ t('board.backToBoards') }}
            </RouterLink>
            <div class="mt-0.5 flex min-w-0 items-center gap-2">
              <h1 class="font-heading min-w-0 truncate text-lg font-extrabold">
                {{ board.title }}
              </h1>
              <span v-if="isArchived" class="badge-pill badge-pill-neutral shrink-0">{{
                t('board.archivedBadge')
              }}</span>
            </div>
            <span class="text-muted text-xs font-semibold">{{ subtitle }}</span>
          </div>
          <UDropdownMenu v-if="canManage" :items="menuItems">
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              square
              :aria-label="t('board.moreActions')"
            />
          </UDropdownMenu>
        </div>
      </Panel>

      <!-- Кто сейчас на доске (14.1) — компактный список аватарок с наездом,
           как в Miro. Показываем, когда >1 участник: аватарка себя выделена.
           Наведение — tooltip с именем. Вся панель — на общей белой
           карточке-подложке (surface-card), а иконка+счётчик внутри неё —
           дополнительно на своей серой пилюле (вложенная подложка, как на
           референсе), аватарки — прямо на белой карточке, без своей. -->
      <Panel v-if="boardSession.presence.length > 1" position="top-right">
        <div
          data-testid="board-presence"
          class="board-presence surface-card flex items-center"
          :aria-label="t('board.presence')"
        >
          <div
            class="board-presence-count"
            :title="t('board.presenceCount', { count: boardSession.presence.length })"
          >
            <UIcon name="i-lucide-users-2" class="size-4" />
            <span>{{ boardSession.presence.length }}</span>
          </div>
          <div class="board-presence-stack">
            <div
              v-for="(entry, index) in boardSession.presence"
              :key="entry.participantId"
              data-testid="board-presence-avatar"
              :data-participant-id="entry.participantId"
              :data-self="entry.participantId === boardSession.participantId ? 'true' : 'false'"
              :data-following="
                entry.participantId === boardSession.followedParticipantId ? 'true' : 'false'
              "
              role="button"
              :tabindex="entry.participantId === boardSession.participantId ? -1 : 0"
              :aria-pressed="entry.participantId === boardSession.followedParticipantId"
              :class="[
                'board-presence-avatar',
                {
                  'board-presence-avatar--self': entry.participantId === boardSession.participantId,
                  'board-presence-avatar--following':
                    entry.participantId === boardSession.followedParticipantId,
                },
              ]"
              :style="{ zIndex: boardSession.presence.length - index }"
              :title="
                entry.participantId === boardSession.participantId ? t('board.you') : entry.name
              "
              :aria-label="
                entry.participantId === boardSession.participantId
                  ? undefined
                  : t('board.followAvatarLabel', { name: entry.name })
              "
              @click="onPresenceAvatarClick(entry)"
              @keydown.enter="onPresenceAvatarClick(entry)"
              @keydown.space.prevent="onPresenceAvatarClick(entry)"
            >
              <img
                v-if="entry.avatarUrl"
                :src="entry.avatarUrl"
                :alt="entry.name"
                class="board-presence-img"
              />
              <span v-else class="board-presence-initials">{{ initials(entry.name) }}</span>
            </div>
          </div>
        </div>
      </Panel>

      <Panel v-if="followedName" position="top-center">
        <div data-testid="board-following" class="board-following surface-card flex items-center">
          <span class="board-following-label">
            {{ t('board.followingPrefix') }}
            <span class="board-following-name">{{ followedName }}</span>
          </span>
          <button
            type="button"
            class="board-following-stop"
            :aria-label="t('board.stopFollowing')"
            @click="boardSession.stopFollowing()"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
          </button>
        </div>
      </Panel>

      <!-- Кластер управления снизу-слева — компоненты @vue-flow/controls (не свои кнопки),
        только переоформлены под токены приложения и в ряд, как в референсе (12.5). Иконки
        встроенных кнопок (zoom/fit-view) — тоже из пака lucide через именованные слоты
        Controls, а не сырые SVG библиотеки, для единообразия со всем остальным проектом.
        show-interactive скрыт: переключает драг/коннект узлов вне нашего UI управления ими -->
      <Controls class="board-controls" :show-interactive="false">
        <template #icon-zoom-in>
          <UIcon name="i-lucide-plus" />
        </template>
        <template #icon-zoom-out>
          <UIcon name="i-lucide-minus" />
        </template>
        <template #icon-fit-view>
          <UIcon name="i-lucide-maximize" />
        </template>
        <span data-testid="board-zoom" class="board-controls-zoom">{{ zoomPercent }}%</span>
        <div class="board-controls-divider" />
        <!-- Undo/redo (12.10) — только для тех, кто вообще может редактировать содержимое -->
        <template v-if="canEdit">
          <ControlButton
            :disabled="!boardSession.canUndo"
            :aria-label="t('board.undo')"
            @click="boardSession.undo()"
          >
            <UIcon name="i-lucide-undo-2" />
          </ControlButton>
          <ControlButton
            :disabled="!boardSession.canRedo"
            :aria-label="t('board.redo')"
            @click="boardSession.redo()"
          >
            <UIcon name="i-lucide-redo-2" />
          </ControlButton>
          <div class="board-controls-divider" />
        </template>
        <!-- i-lucide-expand/shrink, не i-lucide-maximize/minimize — тот символ уже занят
        fit-view выше, а это разные действия: fitview подгоняет зум/пан под содержимое
        холста, fullscreen разворачивает окно браузера (нужен свой, отличимый символ) -->
        <ControlButton
          :aria-label="t(isFullscreen ? 'board.exitFullscreen' : 'board.fullscreen')"
          @click="toggleFullscreen"
        >
          <UIcon :name="isFullscreen ? 'i-lucide-shrink' : 'i-lucide-expand'" />
        </ControlButton>
      </Controls>
    </VueFlow>

    <!-- Чужие курсоры участников (14.1) — позиционируются в world-координатах,
         как в Miro: курсор рисуется на том же месте у всех зрителей. `key` по
         participantId, чтобы Vue не перерожал компонент при обновлении позиции -->
    <BoardCursor
      v-for="entry in boardSession.awareness"
      :key="entry.participantId"
      :entry="entry"
      :self-participant-id="boardSession.participantId"
    />
  </div>
</template>
<style scoped>
.board-canvas-root:fullscreen {
  width: 100vw;
  height: 100vh;
}

.board-canvas-tool-armed :deep(.vue-flow__pane) {
  cursor: crosshair;
}

/* Инструмент «Стрелка» (12.9) — хендлы карточек видны сразу, не только по hover,
   чтобы подсказать новичку, откуда тянуть связь (сам drag-механизм не меняется) */
.board-canvas-tool-armed-arrow :deep(.board-connect-handle) {
  opacity: 1;
}

/*
 * Чужие перемещения долетают дискретными throttled-патчами (~80мс) — без
 * интерполяции это выглядит рвано (жалоба пользователя). Плавно доводим
 * transform между патчами, но не во время СВОЕГО активного драга/резайза
 * (класс "dragging"/"resizing" вешает сам Vue Flow) — иначе собственный
 * курсор будет отставать от карточки.
 */
:deep(.vue-flow__node:not(.dragging):not(.resizing)) {
  transition: transform 120ms linear;
}

/*
 * По умолчанию у Vue Flow `.vue-flow__nodes` явно задан z-index:3, а у
 * `.vue-flow__edge-labels` — нет (auto), поэтому позиционированные потомки с
 * положительным z-index (карточки) красятся ПОВЕРХ него независимо от
 * порядка в DOM. Наши floating-подписи (12.8) — HTML-инпут прямо на стрелке —
 * из-за этого визуально проваливались под соседнюю карточку, когда середина
 * связи оказывалась рядом с её краем (частый случай: геометрия floating edge
 * кладёт точки почти на границу карточки). Поднимаем повыше явным z-index.
 */
:deep(.vue-flow__edge-labels) {
  z-index: 5;
}

/*
 * Рамка выделения (drag-select, 13.5) — базовый `style.css` Vue Flow задаёт
 * ей только z-index, видимый вид (заливка/бордер) живёт в НЕ подключённом
 * у нас `theme-default.css` (не тянем его целиком — конфликтовал бы с уже
 * кастомизированными узлами/хендлами/контролами). Выделение при этом реально
 * работало и без стилей — просто не было видно саму рамку во время протяжки.
 */
:deep(.vue-flow__selection) {
  background: color-mix(in oklch, var(--ui-primary) 8%, transparent);
  border: 1px dashed var(--ui-primary);
}

.board-empty-state {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  pointer-events: none;
}

/*
 * Переоформление кластера @vue-flow/controls под токены приложения и в ряд
 * (референс `.design/main.html`, экран "Доска") — сами кнопки и их клики
 * остаются библиотечными, здесь только внешний вид (12.5). Без :deep() — класс
 * "board-controls" оседает прямо на корневом узле Controls (fallthrough), это
 * тот же элемент, что и .vue-flow__controls, а не его родитель.
 */
.board-controls {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  padding: 6px;
  background: var(--brand-surface);
  border-radius: 14px;
  box-shadow: var(--brand-shadow-card);
}

.board-controls :deep(.vue-flow__controls-button) {
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--brand-ink);
}

.board-controls :deep(.vue-flow__controls-button:hover) {
  background: var(--ui-bg-elevated);
}

/* Библиотечный disabled-стиль (style.css пакета) гасит fill-opacity — не работает для
   контурных (stroke) иконок lucide, поэтому гасим саму кнопку */
.board-controls :deep(.vue-flow__controls-button:disabled) {
  opacity: 0.4;
}

.board-controls :deep(.vue-flow__controls-button svg) {
  max-width: 16px;
  max-height: 16px;
}

.board-controls-zoom {
  min-width: 38px;
  padding: 0 6px;
  color: var(--brand-ink2);
  font-size: 12.5px;
  font-weight: 700;
  text-align: center;
}

.board-controls-divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--brand-border);
}

/* Минимапа @vue-flow/minimap хардкодит белый фон (её style.css) — под токены
   приложения и в обеих темах, как остальные плашки холста (12.5) */
.board-minimap {
  background: var(--brand-surface);
  border-radius: 1.5rem;
  box-shadow: var(--brand-shadow-card);
  overflow: hidden;
}

/* Панель «кто на доске» (14.1) — общая карточка-подложка, внутри неё —
   пилюля счётчика и стек аватарок */
.board-presence {
  gap: 8px;
  max-width: 260px;
  padding: 6px;
  border-radius: 20px;
  overflow: hidden;
}

/* Стек аватарок: каждая наезжает на предыдущую */
.board-presence-stack {
  display: flex;
  align-items: center;
}

.board-presence-avatar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ui-bg);
  border: 2px solid var(--brand-surface);
  overflow: visible;
  z-index: 0;
}

/* gap не поддерживает отрицательные значения (невалидное CSS-объявление
   отбрасывается целиком) — наезд аватарок делаем отрицательным margin */
.board-presence-avatar + .board-presence-avatar {
  margin-left: -11px;
}

/* Себя выделяем акцентной обводкой */
.board-presence-avatar--self {
  border-color: var(--ui-primary);
}

/* Чужую аватарку, за которую слежим — та же акцентная обводка */
.board-presence-avatar--following {
  border-color: var(--ui-primary);
}

/* Аватарка себя не кликабельна — курсор pointer только для чужих */
.board-presence-avatar:not(.board-presence-avatar--self) {
  cursor: pointer;
}

.board-presence-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.board-presence-initials {
  font-size: 11px;
  font-weight: 700;
  color: var(--brand-ink);
}

/* Иконка + счётчик участников — одна серая пилюля (как на референсе), не
   общая карточка на весь блок presence */
.board-presence-count {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  color: var(--brand-ink2);
  background: var(--ui-bg);
  border-radius: 16px;
}

.board-presence-count span {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-ink);
}

/* Плашка «Вы следите за …» (14.5) — та же пилюля-подложка, что и у presence,
   без лишней внутренней карточки: текст + компактная кнопка закрытия */
.board-following {
  gap: 8px;
  height: 32px;
  padding: 0 8px 0 14px;
  border-radius: 16px;
}

.board-following-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--brand-ink);
  white-space: nowrap;
}

.board-following-name {
  color: var(--brand-primary-text);
}

.board-following-stop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  color: var(--brand-ink2);
  transition: background-color 0.15s ease;
}

.board-following-stop:hover {
  background: var(--ui-bg);
}
</style>
