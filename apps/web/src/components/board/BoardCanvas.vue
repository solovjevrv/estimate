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
  isBoardContainer,
  type Board,
  type BoardEdge,
  type BoardItem,
  type BoardItemContent,
  type BoardItemPatchOp,
  type BoardOp,
  type BoardPresenceEntry,
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
  type Connection,
  type EdgeMouseEvent,
  type GraphNode,
  type NodeDragEvent,
} from '@vue-flow/core';
import {
  computed,
  markRaw,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
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
} from '../../lib/board/board-item-defaults';
import {
  BOARD_ACTIVE_TEXT_EDITOR_KEY,
  BOARD_CAN_EDIT_KEY,
  BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY,
  BOARD_PENDING_EDGE_EDIT_ID_KEY,
  BOARD_PENDING_EDIT_ID_KEY,
} from '../../lib/board/board-canvas-keys';
import { readableTextColor } from '../../lib/board/board-colors';
import type { BoardTextEditorHandle } from '../../lib/board/board-rich-text';
import { useBoardHotkeys } from '../../lib/board/use-board-hotkeys';
import type { BoardSelectionEdge, BoardSelectionNode } from '../../lib/board/vue-flow-adapter';
import { toFlowEdges, toFlowNodes } from '../../lib/board/vue-flow-adapter';
import { throttle } from '../../lib/throttle';
import { uuid } from '../../lib/board/uuid';
import {
  BOARD_CAMERA_THROTTLE_MS,
  BOARD_DRAG_THROTTLE_MS,
  BOARD_CURSOR_THROTTLE_MS,
} from '../../lib/board/board-constants';
import {
  computeSnapGuides,
  SNAP_THRESHOLD_PX,
  type SnapGuide,
  type SnapRect,
} from '../../lib/board/board-snap';
import { useBoardSessionStore } from '../../stores/board-session';
import { useBoardClipboard } from '../../features/boards/composables/use-board-clipboard';
import { useBoardCreation } from '../../features/boards/composables/use-board-creation';
import { useBoardSelection } from '../../features/boards/composables/use-board-selection';
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
const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100));

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
 * `dragStartPositions` не пуст — сам пользователь тащит группу локально,
 * пропускаем применение снимка; на `dragStop` карта синхронно пустеет, и
 * следующий реактивный проход применяется как обычно с согласованными
 * позициями. Другие участники, кто-то другой двигает карточку параллельно —
 * тот кейс уже отдельно проверен (см. абзац выше), это не задевается.
 */
const dragStartPositions = new Map<string, { x: number; y: number }>();
/** Активные snap-направляющие для отрисовки во время drag (13.6) */
const activeSnapGuides = ref<SnapGuide[]>([]);

watch(
  flowNodes,
  (next) => {
    if (dragStartPositions.size > 0) return;
    setNodes(next);
  },
  { immediate: true },
);
watch(flowEdges, (next) => setEdges(next), { immediate: true });

const rootEl = useTemplateRef<HTMLElement>('root');
const isFullscreen = ref(false);

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
  onPaneClick,
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
  setPendingEdgeEditId: (id) => {
    pendingEdgeEditId.value = id;
  },
  breakFollowOnEdit,
  textDefaultDimensions,
  // Сохраняем прежнюю baseline-семантику: максимум не ниже 0, минимум не выше 0.
  // Иначе при доске только с отрицательными (или положительными) z-index действие
  // «на передний/задний план» меняло бы поведение после выноса в composable.
  getBoardZIndex: () => ({ max: maxZIndex(props.items), min: minZIndex(props.items) }),
  defaultItemColor: STICKY_DEFAULT_COLOR,
  resolveTextColor: readableTextColor,
  resolveEdgeColor,
});

// Вынесенные в composable состояние и методы, которыми пользуется шаблон.
// Computed-свойства и методы деструктурируются как есть — Vue 3 автораспаковывает
// ref/computed в шаблонах для top-level констант <script setup>. onEdgeDoubleClick
// остается локальным (он про клик по связи, а не про выделение).
const {
  selectionToolbarPosition,
  edgeToolbarPosition,
  selectedForm,
  selectedColor,
  selectedEdgeStyle,
  selectedEdgeColor,
  selectedFontSize,
  canIncreaseSelectedFontSize,
  canDecreaseSelectedFontSize,
  selectedTextColor,
  selectedTextAlign,
  canGroupSelection,
  canUngroupSelection,
  contextMenu,
  onNodeClick,
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
  deleteSelectedEdges,
  patchEdgeLine,
  patchEdgeMarkerStart,
  patchEdgeMarkerEnd,
  patchEdgeColor,
  addTextToSelectedEdge,
  previewSelectedColor,
  cancelSelectedColorPreview,
  previewSelectedTextColor,
  cancelSelectedTextColorPreview,
  previewEdgeColor,
  cancelEdgeColorPreview,
} = selection;

/**
 * Курсоры участников (14.1). Позиция мыши проецируется в canvas-координаты
 * через `project()` и уходит на сервер throttled `sendAwareness('cursor')` —
 * как в Miro: чужой курсор рисуется в world-координатах и не зависит от
 * зума/панорамирования зрителя. Видят курсоры все участники доски (и редакторы,
 * и зрители), а посылать свой может только редактор — зрительный курсор не
 * интересен, его движение ничего не меняет.
 */
// self id теперь — boardSession.participantId (14.5): ключ участника на доске,
// а не userId — гость (userId null) тоже видит себя выделенным в стеке presence

/** Инициалы из имени для fallback-аватарки (14.1) */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]![0]!.toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Клик по аватарке в стеке presence (14.5) — переключить follow-mode */
function onPresenceAvatarClick(entry: BoardPresenceEntry): void {
  if (entry.participantId === boardSession.participantId) return;
  if (boardSession.followedParticipantId === entry.participantId) {
    boardSession.stopFollowing();
  } else {
    boardSession.followParticipant(entry.participantId);
  }
}

const followedName = computed(() => {
  const id = boardSession.followedParticipantId;
  if (!id) return null;
  return boardSession.presence.find((p) => p.participantId === id)?.name ?? null;
});

function onPaneMouseMove(event: MouseEvent): void {
  if (!props.canEdit) return;
  const rect = rootEl.value?.getBoundingClientRect();
  const point = rect
    ? project({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    : { x: 0, y: 0 };
  void boardSession.sendAwareness('cursor', { x: point.x, y: point.y });
}

/** Throttle-обёртка над sendAwareness, как для драга (BOARD_CURSOR_THROTTLE_MS) */
const cursorThrottler = throttle(onPaneMouseMove, BOARD_CURSOR_THROTTLE_MS);

/**
 * Собственная камера (14.5) — throttled-рассылка позиции viewport на каждый
 * изменяющийся пан/зум. Грубее курсора, чтобы не слепо перегружать сеть панорамированием.
 */
const cameraThrottler = throttle(
  () =>
    boardSession.sendAwareness('camera', {
      x: viewport.value.x,
      y: viewport.value.y,
      zoom: viewport.value.zoom,
    }),
  BOARD_CAMERA_THROTTLE_MS,
);
watch(
  viewport,
  () => {
    // Пока сам кого-то смотрю — не транслирую свою камеру: иначе камера, которую
    // мне же сейчас программно проставляет follow-режим, эхом улетала бы моим
    // наблюдателям как «моя настоящая позиция» — путаница и потенциальный
    // цикл, если двое подписаны друг на друга
    if (boardSession.followedParticipantId) return;
    cameraThrottler();
  },
  { deep: true },
);

watch(
  () => boardSession.cameraOfFollowed,
  (cam) => {
    if (!cam) return;
    void setViewport({ x: cam.x, y: cam.y, zoom: cam.zoom }, { duration: 200 });
  },
);

function onManualCameraInteraction(): void {
  if (boardSession.followedParticipantId) boardSession.stopFollowing();
}

function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement === rootEl.value;
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void rootEl.value?.requestFullscreen();
  }
}

// `onCopy` асинхронная (сериализация картинок читает байты), а слушатель события
// ждёт синхронную функцию: отданный ему промис никто не подхватывает, и отказ
// внутри стал бы необработанным. Оборачиваем один раз — ссылка нужна той же
// самой, иначе removeEventListener ниже не снимет обработчик.
const onCopyListener = (event: ClipboardEvent): void => {
  void onCopy(event);
};

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('paste', onPaste);
  document.addEventListener('copy', onCopyListener);
});
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('paste', onPaste);
  document.removeEventListener('copy', onCopyListener);
  dragThrottlers.clear();
  dragStartPositions.clear();
});

/**
 * `dragThrottlers`/`dragStartPositions` копятся по `node.id` (17.9) —
 * `BoardPage.vue` переиспользует один и тот же `BoardCanvas` при смене доски
 * (меняет пропы, не размонтирует компонент), так что без явной очистки записи
 * от уже покинутой доски продолжали бы висеть в памяти всю сессию страницы.
 */
watch(
  () => props.board.id,
  () => {
    dragThrottlers.clear();
    dragStartPositions.clear();
  },
);

// --- Инструменты и создание стикеров (12.6) ---
// activeTool и pendingEditId пришли из useBoardCreation (см. выше), здесь
// только provide для потребителей через контекст доски.

/** Id связи, подпись которой нужно открыть для ввода текста прямо на стрелке (12.8) */
const pendingEdgeEditId = ref<string | null>(null);
provide(
  BOARD_CAN_EDIT_KEY,
  computed(() => props.canEdit),
);
provide(BOARD_PENDING_EDIT_ID_KEY, pendingEditId);
provide(BOARD_PENDING_EDGE_EDIT_ID_KEY, pendingEdgeEditId);
/**
 * Хэндл узла, сейчас редактирующего текст (12.13) — публикует его сам узел,
 * см. `board-rich-text.ts`. `shallowRef`, не `ref` — иначе Vue своим
 * `UnwrapRef` рекурсивно распаковал бы вложенный `activeMarks: Ref<...>`
 * внутри хэндла до голого значения, ломая типы и реактивность самого поля.
 */
const activeTextEditor = shallowRef<BoardTextEditorHandle | null>(null);
provide(BOARD_ACTIVE_TEXT_EDITOR_KEY, activeTextEditor);

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
 * нарушается (он не может вмешаться).
 */
function breakFollowOnEdit(): void {
  if (props.canEdit && boardSession.followedParticipantId) {
    boardSession.stopFollowing();
  }
}

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

// --- Перетаскивание: локально холст двигает сам Vue Flow, по сети —
// throttled-патчи на каждый кадр драга плюс гарантированный финальный на
// dragstop (12.6). Троттлер свой на элемент — иначе при мультивыборе только
// последний по порядку элемент кадра реально долетал бы до сети.
const dragThrottlers = new Map<string, (node: GraphNode<BoardItem>) => void>();

function childrenOf(containerId: string): BoardItem[] {
  return props.items.filter((candidate) => candidate.parentId === containerId);
}

/** Конвертирует узел Vue Flow в SnapRect для вычисления snap guide */
function nodeToSnapRect(node: GraphNode<BoardItem>): SnapRect {
  return {
    id: node.id,
    x: node.computedPosition.x,
    y: node.computedPosition.y,
    width: node.dimensions.width,
    height: node.dimensions.height,
  };
}

/**
 * Патчи-сдвиги для детей контейнера при его перетаскивании (14.3). Домен
 * хранит `x`/`y` детей АБСОЛЮТНЫМИ (см. vue-flow-adapter.ts) — Vue Flow сам
 * визуально двигает их вместе с родителем во время живого драга (это его
 * внутренний рендер поверх `parentNode`), но это НЕ то же самое, что реально
 * записать их новый `x`/`y` в стор. Без этого при следующем же обновлении
 * `flowNodes` (из стора — а `event.nodes` для драга РОДИТЕЛЯ в Vue Flow не
 * включает потомков, только сам перетаскиваемый узел) относительная позиция
 * ребёнка (child.x - parent.x) пересчиталась бы от НЕизменившегося child.x и
 * уже сдвинутого parent.x — то есть съехала бы на дельту в другую сторону,
 * ребёнок дёргался бы туда-сюда при каждом сетевом эхе (найдено вручную:
 * непредсказуемый "прыгающий" драг фрейма с содержимым). Каждый ребёнок
 * двигается на ТУ ЖЕ дельту, что и контейнер, от его собственной стартовой
 * позиции (`dragStartPositions`, засеяна в onNodeDragStart) — не от текущей
 * позиции в сторе, чтобы дельты не накапливались по кадрам троттлинга.
 */
/** Сдвиг {id → {x,y}} на дельту от собственного старта, каждого по СВОЕЙ стартовой позиции */
function shiftOps(
  mates: readonly BoardItem[],
  dx: number,
  dy: number,
): { ops: BoardOp[]; inverse: BoardOp[] } {
  const ops: BoardOp[] = [];
  const inverse: BoardOp[] = [];
  for (const mate of mates) {
    const start = dragStartPositions.get(mate.id) ?? { x: mate.x, y: mate.y };
    ops.push({
      type: 'item.patch',
      clientOpId: uuid(),
      id: mate.id,
      patch: { x: start.x + dx, y: start.y + dy },
    });
    inverse.push({
      type: 'item.patch',
      clientOpId: uuid(),
      id: mate.id,
      patch: { x: start.x, y: start.y },
    });
  }
  return { ops, inverse };
}

/**
 * Патчи-спутники драга ОДНОГО узла (14.3) — то, что должно сдвинуться на ту
 * же дельту, что и сам перетаскиваемый узел, но не входит в `event.nodes`
 * (Vue Flow не включает туда ни детей контейнера, ни соседей по группе).
 * Патч самого `node` строит отдельно `sendPositionPatch`.
 *
 * Два принципиально разных случая:
 * - `node` — КОНТЕЙНЕР (frame/group): тащим за собой всех его детей — дельта
 *   считается от старта самого контейнера. Домен хранит `x`/`y` детей
 *   АБСОЛЮТНЫМИ (см. vue-flow-adapter.ts) — без явной записи их нового
 *   абсолютного `x`/`y` в стор при следующем обновлении `flowNodes`
 *   относительная позиция ребёнка (child.x - parent.x) пересчиталась бы от
 *   НЕизменившегося child.x и уже сдвинутого parent.x, т.е. съехала бы в
 *   другую сторону — ребёнок дёргался бы туда-сюда при каждом сетевом эхе
 *   (найдено вручную: непредсказуемый "прыгающий" драг фрейма с содержимым).
 * - `node` — участник ГРУППЫ (не фрейма): группа — жёсткий пучок, а не
 *   контейнер-холст, как фрейм. Драг ЛЮБОГО её участника двигает саму
 *   группу-контейнер и ВСЕХ остальных участников тоже (не только контейнер
 *   двигает участников, но и наоборот) — иначе перетаскивание за один из
 *   членов группы отрывало бы его от остальных (найдено вручную).
 */
function dragCascadeOps(node: {
  id: string;
  data: BoardItem;
  computedPosition: { x: number; y: number };
}): { ops: BoardOp[]; inverse: BoardOp[] } {
  const start = dragStartPositions.get(node.id);
  if (!start) return { ops: [], inverse: [] };
  const dx = node.computedPosition.x - start.x;
  const dy = node.computedPosition.y - start.y;
  if (isBoardContainer(node.data.content.type)) {
    return shiftOps(childrenOf(node.id), dx, dy);
  }
  if (node.data.parentId !== null) {
    const parent = props.items.find((candidate) => candidate.id === node.data.parentId);
    if (parent?.content.type === 'group') {
      const mates = [parent, ...childrenOf(parent.id).filter((mate) => mate.id !== node.id)];
      return shiftOps(mates, dx, dy);
    }
  }
  return { ops: [], inverse: [] };
}

function sendPositionPatch(
  node: GraphNode<BoardItem>,
  opts: { record?: boolean; inverse?: BoardOp[] } = {},
  /** Задан — узел на dragStop сменил родителя (drag-in/out фрейма, 14.3), см. onNodeDragStop */
  parentId?: string | null,
): void {
  const patch: BoardItemPatchOp['patch'] = {
    x: node.computedPosition.x,
    y: node.computedPosition.y,
  };
  if (parentId !== undefined) patch.parentId = parentId;
  const ops: BoardOp[] = [
    { type: 'item.patch', clientOpId: uuid(), id: node.id, patch },
    ...dragCascadeOps(node).ops,
  ];
  void boardSession.applyOps(ops, opts);
}

/**
 * Родитель, которого должен получить перетаскиваемый узел на dragStop (14.3).
 * Контейнеры (frame/group) сами никогда не вкладываются — вложенность
 * запрещена сервером.
 *
 * Участник ГРУППЫ — членство жёсткое, меняется только явным «Разгруппировать»,
 * не геометрией драга (группа невидима, у нее нет заметных пользователю
 * границ, чтобы целиться, и авто-переприклеивание по bounding box было бы
 * непредсказуемым — найдено вручную).
 *
 * Верхнеуровневый элемент или участник ФРЕЙМА — родитель пересчитывается от
 * ТЕКУЩЕЙ позиции всегда, а не сохраняется навсегда после первого попадания:
 * это единственный способ узнать, что элемент вытащили ЗА пределы фрейма
 * (иначе элемент, однажды помещённый во фрейм, продолжал бы считаться его
 * ребёнком и ездить вместе с ним, даже оказавшись визуально далеко снаружи —
 * баг, найденный вручную). Если новая точка — внутри ДРУГОГО фрейма, элемент
 * перепривязывается сразу к нему, без промежуточного "открепления".
 */
function resolveDragParent(node: GraphNode<BoardItem>): string | null {
  if (isBoardContainer(node.data.content.type)) return null;
  const parent =
    node.data.parentId !== null
      ? props.items.find((candidate) => candidate.id === node.data.parentId)
      : undefined;
  if (parent?.content.type === 'group') return node.data.parentId;
  const center = {
    x: node.computedPosition.x + node.dimensions.width / 2,
    y: node.computedPosition.y + node.dimensions.height / 2,
  };
  return containerAt(center, node.id)?.id ?? null;
}

/**
 * Shift+drag — ограничение перетаскивания по одной оси (12.9), как в Miro.
 * Стартовая позиция каждого узла драга запоминается на `node-drag-start`
 * (в `dragStartPositions`, объявлена выше вместе с watcher'ом `flowNodes` —
 * 13.5); дальше на каждом кадре, пока зажат Shift, "недоминирующая" ось (та,
 * где смещение от старта меньше) принудительно возвращается к стартовому
 * значению — Vue Flow обновляет `computedPosition` синхронно ДО эмита
 * `node-drag`, так что наша правка успевает попасть в кадр до отрисовки.
 * Ось перевычисляется на каждом кадре (не фиксируется на первом сдвиге) —
 * упрощение, для мелкого дрожания курсора у диагонали не критично.
 */

/** Все узлы, чью стартовую позицию нужно засеять вместе с самим `node` (14.3, см. dragCascadeOps) */
function dragFamilyOf(node: BoardItem): BoardItem[] {
  if (isBoardContainer(node.content.type)) return childrenOf(node.id);
  if (node.parentId !== null) {
    const parent = props.items.find((candidate) => candidate.id === node.parentId);
    if (parent?.content.type === 'group') {
      return [parent, ...childrenOf(parent.id).filter((mate) => mate.id !== node.id)];
    }
  }
  return [];
}

function onNodeDragStart({ nodes: dragged }: NodeDragEvent): void {
  breakFollowOnEdit();
  for (const node of dragged as GraphNode<BoardItem>[]) {
    dragStartPositions.set(node.id, { x: node.computedPosition.x, y: node.computedPosition.y });
    // Спутники драга (дети контейнера ИЛИ соседи по группе, 14.3) не входят в
    // event.nodes — засеваем их стартовые позиции здесь же, иначе дельту
    // сдвига не от чего было бы посчитать на драге/dragStop (см. dragCascadeOps)
    for (const mate of dragFamilyOf(node.data)) {
      dragStartPositions.set(mate.id, { x: mate.x, y: mate.y });
    }
  }
}

/**
 * Сравнение по значениям (id таргетов + позиция + диапазон линии), не только
 * по длине — используется в `updateSnapGuides`, чтобы не писать в
 * `activeSnapGuides` (и не гонять лишний ре-рендер `BoardSnapGuides`) на
 * кадрах драга, где набор гидов не изменился относительно предыдущего кадра.
 * Чаще всего оба массива пустые (курсор далеко от порога притяжения) — в этом
 * случае сравнение почти бесплатное (обе длины 0).
 */
function guidesEqual(a: SnapGuide[], b: SnapGuide[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const g1 = a[i]!;
    const g2 = b[i]!;
    if (
      g1.orientation !== g2.orientation ||
      g1.position !== g2.position ||
      g1.from !== g2.from ||
      g1.to !== g2.to ||
      g1.targetIds.length !== g2.targetIds.length ||
      g1.targetIds.some((id, idx) => id !== g2.targetIds[idx])
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Snap-направляющие при перетаскивании (13.6): вычисляем притягивание к
 * краям/центрам статичных элементов и сохраняем активные гиды для визуального
 * отображения в `BoardSnapGuides`. Только отображение — позиция узлов НЕ
 * меняется (иначе Vue Flow «залипает»: он использует изменённую `position` как
 * новую базовую для следующего кадра drag). Снап позиции применяется
 * отдельной функцией `applySnapPosition` только на dragStop.
 * Порог переводится из скриншотных пикселей в canvas-координаты через viewport.zoom.
 *
 * Расчёт (`computeSnapGuides`) не троттлится — он должен реагировать на каждый
 * кадр, чтобы направляющая появлялась/исчезала без задержки. Троттлится (через
 * `guidesEqual`) только реактивная запись: пропускаем её, если новый набор
 * гидов совпадает с уже отображаемым — иначе на каждом кадре драга без снапа
 * (частый случай) `activeSnapGuides.value = []` всё равно создавала бы новый
 * массив и триггерила реактивность/ре-рендер `BoardSnapGuides` впустую.
 */
function updateSnapGuides(event: NodeDragEvent): void {
  const dragged = event.nodes as GraphNode<BoardItem>[];
  if (dragged.length === 0) {
    if (activeSnapGuides.value.length > 0) activeSnapGuides.value = [];
    return;
  }
  const draggedIds = new Set(dragged.map((n) => n.id));
  const staticRects = getNodes.value.filter((n) => !draggedIds.has(n.id)).map(nodeToSnapRect);
  const draggedRects = dragged.map(nodeToSnapRect);
  const threshold = SNAP_THRESHOLD_PX / Math.max(viewport.value.zoom, 0.1);
  const result = computeSnapGuides(draggedRects, staticRects, threshold);
  if (!guidesEqual(result.guides, activeSnapGuides.value)) {
    activeSnapGuides.value = result.guides;
  }
}

/**
 * Применяет snap-позицию к узлам — только на dragStop, чтобы не ломать
 * Vue Flow-драг (см. updateSnapGuides). Если узел близок к выравниванию,
 * его позиция округляется до неё.
 */
function applySnapPosition(event: NodeDragEvent): void {
  const dragged = event.nodes as GraphNode<BoardItem>[];
  if (dragged.length === 0) return;
  const draggedIds = new Set(dragged.map((n) => n.id));
  const staticRects = getNodes.value.filter((n) => !draggedIds.has(n.id)).map(nodeToSnapRect);
  const draggedRects = dragged.map(nodeToSnapRect);
  const threshold = SNAP_THRESHOLD_PX / Math.max(viewport.value.zoom, 0.1);
  const result = computeSnapGuides(draggedRects, staticRects, threshold);

  for (const node of dragged) {
    const snapped = result.positions.get(node.id);
    if (snapped) {
      node.computedPosition.x = snapped.x;
      node.computedPosition.y = snapped.y;
      node.position.x = snapped.x;
      node.position.y = snapped.y;
    }
  }
}

function applyAxisLock(event: NodeDragEvent): void {
  if (!(event.event instanceof MouseEvent) || !event.event.shiftKey) return;
  for (const node of event.nodes as GraphNode<BoardItem>[]) {
    const start = dragStartPositions.get(node.id);
    if (!start) continue;
    const dx = node.computedPosition.x - start.x;
    const dy = node.computedPosition.y - start.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      node.computedPosition.y = start.y;
      node.position.y = start.y;
    } else {
      node.computedPosition.x = start.x;
      node.position.x = start.x;
    }
  }
}

function onNodeDrag(event: NodeDragEvent): void {
  applyAxisLock(event);
  updateSnapGuides(event);
  // Во время драга узла реальный mousemove на пейне не долетает до
  // cursorThrottler (указатель перехвачен драгом Vue Flow) — без этого чужой
  // курсор замирал бы, пока сам элемент продолжает двигаться под ним.
  if (event.event instanceof MouseEvent) cursorThrottler(event.event);
  for (const node of event.nodes as GraphNode<BoardItem>[]) {
    let send = dragThrottlers.get(node.id);
    if (!send) {
      // record: false — промежуточные тики жеста не попадают в историю undo/redo
      // (12.10), иначе одна отмена откатывала бы только последние ~80мс драга,
      // а не перенос целиком. Единственная запись истории — на dragstop ниже.
      send = throttle(
        (n: GraphNode<BoardItem>) => sendPositionPatch(n, { record: false }),
        BOARD_DRAG_THROTTLE_MS,
      );
      dragThrottlers.set(node.id, send);
    }
    send(node);
  }
}

function onNodeDragStop(event: NodeDragEvent): void {
  applyAxisLock(event);
  applySnapPosition(event);
  activeSnapGuides.value = [];
  for (const node of event.nodes as GraphNode<BoardItem>[]) {
    const start = dragStartPositions.get(node.id);
    const moved =
      !start || start.x !== node.computedPosition.x || start.y !== node.computedPosition.y;
    // Отпустили верхнеуровневый элемент внутри границ фрейма/группы — «приклеиваем»
    // его к ней (Miro-семантика, 14.3), см. resolveDragParent
    const nextParentId = resolveDragParent(node);
    const parentChanged = nextParentId !== node.data.parentId;
    // Инверсия — стартовая позиция ВСЕГО жеста (12.10), не позиция перед этим
    // конкретным финальным патчем (та уже почти совпадает с текущей из-за
    // троттлед-тиков выше — откат по ней был бы почти незаметен). Клик без
    // реального сдвига (start === финал) вообще не пишем в историю — иначе
    // случайный микро-жест засорял бы стек no-op записью. Если сменился и
    // родитель — откатываем и его тоже, иначе Ctrl+Z вернул бы позицию, но
    // оставил элемент приклеенным к фрейму. Спутники драга (14.3 — дети
    // контейнера или соседи по группе) откатываются к СВОИМ стартовым позициям
    // тем же undo-шагом — иначе после отмены перетаскивания фрейма/группы он
    // вернулся бы на место, а его содержимое/остальные участники — нет.
    const mateInverse = dragCascadeOps(node).inverse;
    const inverse: BoardOp[] | undefined = start
      ? [
          {
            type: 'item.patch',
            clientOpId: uuid(),
            id: node.id,
            patch: {
              x: start.x,
              y: start.y,
              ...(parentChanged ? { parentId: node.data.parentId } : {}),
            },
          },
          ...mateInverse,
        ]
      : undefined;
    sendPositionPatch(
      node,
      { record: moved || parentChanged, inverse },
      parentChanged ? nextParentId : undefined,
    );
    dragStartPositions.delete(node.id);
    for (const mate of dragFamilyOf(node.data)) dragStartPositions.delete(mate.id);
  }
}

function onEdgeDoubleClick({ edge }: EdgeMouseEvent): void {
  if (!props.canEdit) return;
  pendingEdgeEditId.value = edge.id;
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
    selection.deleteSelectedEdges();
  },
  duplicateSelection: duplicateSelected,
  selectAll: selection.selectAllElements,
  clearSelection: () => {
    selection.clearAllSelection();
    selection.closeContextMenu();
  },
  resetZoom: () => {
    boardSession.stopFollowing();
    void zoomTo(1);
  },
  fitView: () => {
    boardSession.stopFollowing();
    void fitView();
  },
  undo: () => void boardSession.undo(),
  redo: () => void boardSession.redo(),
});

function onConnect(event: Connection): void {
  if (!props.canEdit) return;
  const id = uuid();
  void boardSession.applyOps([
    {
      type: 'edge.create',
      clientOpId: uuid(),
      edge: {
        id,
        sourceItemId: event.source,
        targetItemId: event.target,
        // Конкретная точка на карточке (top/right/bottom/left), которую реально
        // схватили/отпустили — не «ближайшая сторона», решение пользователя
        // 07.08.2026 после ручной проверки (см. floating-edge-geometry.ts)
        sourceHandle: event.sourceHandle ?? null,
        targetHandle: event.targetHandle ?? null,
        label: null,
        // Цвет не задаём (12.9) — решается на лету от темы каждого зрителя
        // (см. resolveEdgeColor), пока пользователь явно не выберет свой
        style: { line: 'curved', markerStart: 'none', markerEnd: 'arrow' },
      },
    },
  ]);
  // Инструмент «Стрелка» (12.9) — только affordance, само создание не зависит от
  // него (drag от хендла работает всегда), но после успешного соединения логично
  // вернуть инструмент на «Выделение», как у стикера/фигуры
  if (activeTool.value === 'arrow') activeTool.value = 'select';
}
</script>

<template>
  <div
    ref="root"
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
      @connect="onConnect"
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
      @edge-double-click="onEdgeDoubleClick"
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
        :current-marker-start="selectedEdgeStyle.markerStart"
        :current-marker-end="selectedEdgeStyle.markerEnd"
        :current-color="selectedEdgeColor"
        @line="patchEdgeLine"
        @marker-start="patchEdgeMarkerStart"
        @marker-end="patchEdgeMarkerEnd"
        @color="patchEdgeColor"
        @color-preview="previewEdgeColor"
        @color-cancel="cancelEdgeColorPreview"
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
        @add-text="addTextToSelectedEdge"
        @delete="contextMenu.target === 'item' ? deleteSelected() : deleteSelectedEdges()"
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
              :data-participant-id="entry.participantId"
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
        <div class="board-following surface-card flex items-center">
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
        <span class="board-controls-zoom">{{ zoomPercent }}%</span>
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
