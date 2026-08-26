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
import { BOARD_OPS_BATCH_MAX, type Board, type BoardEdge, type BoardItem } from '@poker/shared';
import type { DropdownMenuItem } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { Background } from '@vue-flow/background';
import { MiniMap } from '@vue-flow/minimap';
import {
  ConnectionMode,
  useNodesInitialized,
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
  resolveEdgeColor,
  STICKY_DEFAULT_COLOR,
  textDefaultDimensions,
  zIndexRange,
} from '../../features/boards/config/board-item-defaults';
import {
  BOARD_ACTIVE_TEXT_EDITOR_KEY,
  BOARD_CAN_EDIT_KEY,
  BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY,
  BOARD_PENDING_EDGE_EDIT_ID_KEY,
  BOARD_PENDING_EDIT_ID_KEY,
} from '../../features/boards/context/board-canvas-keys';
import { readableTextColor } from '../../features/boards/domain/board-colors';
import { findFrameAt } from '../../features/boards/domain/board-containers';
import { selectionEscapedActiveEditor } from '../../features/boards/domain/board-text-editing';
import type { BoardTextEditorHandle } from '../../features/boards/rich-text/board-rich-text';
import { useBoardAutoFit } from '../../features/boards/composables/use-board-auto-fit';
import { useBoardHotkeys } from '../../features/boards/composables/use-board-hotkeys';
import type {
  BoardDragEvent,
  BoardDragNode,
  BoardFlowEdge,
  BoardFlowNode,
  BoardSelectionEdge,
  BoardSelectionNode,
} from '../../features/boards/adapters/vue-flow-adapter';
import {
  createFlowEdgesConverter,
  createFlowNodesConverter,
} from '../../features/boards/adapters/vue-flow-adapter';
import { useBoardSessionStore } from '../../stores/board-session';
import { useBoardClipboard } from '../../features/boards/composables/use-board-clipboard';
import { useBoardCreation } from '../../features/boards/composables/use-board-creation';
import { useBoardDragAndSnap } from '../../features/boards/composables/use-board-drag-and-snap';
import { useBoardEdges } from '../../features/boards/composables/use-board-edges';
import { useBoardSelection } from '../../features/boards/composables/use-board-selection';
import { useBoardViewport } from '../../features/boards/composables/use-board-viewport';
import BoardSelectionToolbar from './BoardSelectionToolbar.vue';
import BoardContextMenu from './BoardContextMenu.vue';
import BoardControlsCluster from './BoardControlsCluster.vue';
import BoardCursor from './BoardCursor.vue';
import BoardEdgeToolbar from './BoardEdgeToolbar.vue';
import BoardFollowingBanner from './BoardFollowingBanner.vue';
import BoardFloatingEdge from './BoardFloatingEdge.vue';
import BoardGiphyNode from './BoardGiphyNode.vue';
import BoardImageNode from './BoardImageNode.vue';
import BoardPresencePanel from './BoardPresencePanel.vue';
import BoardShapeNode from './BoardShapeNode.vue';
import BoardSnapGuides from './BoardSnapGuides.vue';
import BoardStickyNode from './BoardStickyNode.vue';
import BoardTextNode from './BoardTextNode.vue';
import BoardTitlePanel from './BoardTitlePanel.vue';
import BoardEmojiNode from './BoardEmojiNode.vue';
import BoardStickerNode from './BoardStickerNode.vue';
import BoardToolbar from './BoardToolbar.vue';
import BoardFrameNode from './BoardFrameNode.vue';

import '@vue-flow/core/dist/style.css';
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

// Мемоизирующие конвертеры (17.8) — по одному инстансу кэша на весь холст,
// не на каждый вызов computed: инвалидация по id/ссылке/canEdit/теме внутри
// `createFlowNodesConverter`/`createFlowEdgesConverter`. Кэш переживает смену
// доски безопасно — id элементов глобально уникальны, устаревшие записи
// самоочищаются в первом же пересчёте новой доски (не встречаются в новом
// снимке → вычищаются как "не увиденные").
const toFlowNodesMemoized = createFlowNodesConverter();
const toFlowEdgesMemoized = createFlowEdgesConverter();
const flowNodes = computed(() => toFlowNodesMemoized(props.items, props.canEdit));
const flowEdges = computed(() => toFlowEdgesMemoized(props.edges));

// markRaw — иначе Vue оборачивает объект с компонентами в reactive() и предупреждает
// об этом в консоли (компонент-конструктор реактивным быть не должен)
const nodeTypes = markRaw({
  sticky: BoardStickyNode,
  shape: BoardShapeNode,
  text: BoardTextNode,
  image: BoardImageNode,
  emoji: BoardEmojiNode,
  sticker: BoardStickerNode,
  giphy: BoardGiphyNode,
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
  createGiphyAtCenter,
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
  selectItems: (ids) => addSelectedNodes(ids.map((id) => ({ id }) as GraphNode<BoardItem>)),
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

/** Диапазон zIndex по карточкам и связям вместе — вычисление и причина в `zIndexRange` (17.1) */
const getBoardZIndex = (): { max: number; min: number } =>
  zIndexRange([...props.items, ...props.edges]);

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
  getBoardZIndex,
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
  selectedActiveMarks,
  selectedFontSizeMode,
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
  setSelectedFontSizeMode,
  setSelectedTextColor,
  setSelectedTextAlign,
  toggleSelectedMark,
  setSelectedHighlight,
  setSelectedEmoji,
  setSelectedSticker,
  setSelectedGiphy,
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
  getBoardZIndex,
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

/** Автофит при первом появлении содержимого доски (17.12) — логика в `useBoardAutoFit` (17.1) */
const autoFit = useBoardAutoFit({ nodesInitialized: useNodesInitialized(), fitView });

/**
 * `BoardPage.vue` переиспользует один и тот же `BoardCanvas` при смене доски
 * (меняет пропы, не размонтирует компонент), так что без явной очистки записи
 * от уже покинутой доски (в т.ч. trailing throttles) продолжали бы висеть в
 * памяти всю сессию страницы. Состояние — в composable, а не в локальном Map.
 * Автофит тоже переармируется — иначе вторая и последующие доски за сессию
 * открывались бы без начальной подгонки вида вовсе.
 */
watch(
  () => props.board.id,
  () => {
    dragAndSnap.reset();
    viewportControl.resetAwareness();
    autoFit.rearm();
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

/**
 * Мультивыбор во время редактирования текста (12.23) — shift-клик добавляет в
 * выделение ДРУГОЙ узел, не снимая выделения с редактируемого. `watch(isSelected)`
 * в `use-rich-text-editing.ts` при этом не срабатывает — сам редактируемый узел
 * остаётся `selected`, — а тулбар начинает целиться в разные элементы:
 * заливка/форма/шрифт (`selectedNodes[0]`) могут указывать на только что
 * добавленный узел, тогда как начертание/ссылка (`activeTextEditor`) — всё ещё
 * на исходный. Форсируем коммит редактирования, как только выделение включает
 * кого-то кроме самого редактируемого узла.
 */
watch(selection.selectedNodes, (nodes) => {
  const editor = activeTextEditor.value;
  if (
    editor &&
    selectionEscapedActiveEditor(
      editor.itemId,
      nodes.map((node) => node.id),
    )
  ) {
    editor.commit();
  }
});

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

/** Фрейм, в чьи границы попадает точка — геометрия в `findFrameAt` (17.1) */
function containerAt(point: { x: number; y: number }, excludeId?: string): BoardItem | undefined {
  return findFrameAt(props.items, point, excludeId);
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

// --- Хоткеи (12.9): Delete/Backspace, Ctrl(Cmd)+A/D/0/1, Escape; +Z/Shift+Z/Y (12.10) ---

useBoardHotkeys({
  canEdit: computed(() => props.canEdit),
  deleteSelection: selection.deleteSelection,
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
        @giphy="createGiphyAtCenter"
      />

      <BoardSelectionToolbar
        v-if="selectionToolbarPosition"
        :left="selectionToolbarPosition.left"
        :top="selectionToolbarPosition.top"
        :current-color="selectedColor"
        :current-form="selectedForm"
        :current-font-size="selectedFontSize"
        :current-font-size-mode="selectedFontSizeMode"
        :can-increase-font-size="canIncreaseSelectedFontSize"
        :can-decrease-font-size="canDecreaseSelectedFontSize"
        :current-text-color="selectedTextColor"
        :current-text-align="selectedTextAlign"
        :editing-text="!!activeTextEditor"
        :active-marks="activeTextEditor ? activeTextEditor.activeMarks.value : selectedActiveMarks"
        :has-text-selection="activeTextEditor?.hasTextSelection.value ?? false"
        @color="setSelectedColor"
        @color-preview="previewSelectedColor"
        @color-cancel="cancelSelectedColorPreview"
        @form="setSelectedForm"
        @font-size="setSelectedFontSize"
        @font-size-mode="setSelectedFontSizeMode"
        @text-color="setSelectedTextColor"
        @text-color-preview="previewSelectedTextColor"
        @text-color-cancel="cancelSelectedTextColorPreview"
        @text-align="setSelectedTextAlign"
        @toggle-mark="
          activeTextEditor ? activeTextEditor.toggle($event) : toggleSelectedMark($event)
        "
        @set-highlight="
          activeTextEditor ? activeTextEditor.setHighlight($event) : setSelectedHighlight($event)
        "
        @set-link="activeTextEditor?.setLink($event)"
        @duplicate="duplicateSelected"
        @delete="deleteSelected"
        @replace-image="replaceSelectedImage"
        @emoji="setSelectedEmoji"
        @sticker="setSelectedSticker"
        @giphy="setSelectedGiphy"
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

      <BoardTitlePanel
        :board="board"
        :is-archived="isArchived"
        :subtitle="subtitle"
        :can-manage="canManage"
        :menu-items="menuItems"
      />

      <BoardPresencePanel
        v-if="boardSession.presence.length > 1"
        :presence="boardSession.presence"
        :participant-id="boardSession.participantId"
        :followed-participant-id="boardSession.followedParticipantId"
        :initials="initials"
        @avatar-click="onPresenceAvatarClick"
      />

      <BoardFollowingBanner
        v-if="followedName"
        :name="followedName"
        @stop="boardSession.stopFollowing()"
      />

      <BoardControlsCluster
        :zoom-percent="zoomPercent"
        :can-edit="canEdit"
        :can-undo="boardSession.canUndo"
        :can-redo="boardSession.canRedo"
        :is-fullscreen="isFullscreen"
        @undo="boardSession.undo()"
        @redo="boardSession.redo()"
        @toggle-fullscreen="toggleFullscreen"
      />
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

/*
 * Узел/связь получают нативный DOM-фокус (клавиатурная a11y-навигация Vue
 * Flow — например, стрелки для сдвига выделенного узла), а браузерный дефолтный
 * контур фокуса для них глушится только в НЕ подключённом у нас `theme-default.css`
 * (см. пояснение про `.vue-flow__selection` выше — по той же причине не тянем
 * его целиком). Без этого правила выделение узла иногда рисовало прямо поверх
 * карточки синий прямоугольник ровно по её границе (браузерный `outline`,
 * никак не связанный с нашими зелёными хендлами ресайза) — баг, найден
 * пользователем 26.08.2026 после того, как автовыделение только что созданного
 * элемента (см. `use-board-creation.ts`) сделало путь к нативному фокусу узла
 * куда более частым, чем раньше.
 */
:deep(.vue-flow__node:focus),
:deep(.vue-flow__node:focus-visible),
:deep(.vue-flow__edge:focus),
:deep(.vue-flow__edge:focus-visible) {
  outline: none;
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

/* Минимапа @vue-flow/minimap хардкодит белый фон (её style.css) — под токены
   приложения и в обеих темах, как остальные плашки холста (12.5) */
.board-minimap {
  background: var(--brand-surface);
  border-radius: 1.5rem;
  box-shadow: var(--brand-shadow-card);
  overflow: hidden;
}
</style>
