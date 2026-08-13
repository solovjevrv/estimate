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
 * кастомный цвет через нативный `<input type="color">`.
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
  BOARD_IMAGE_ALLOWED_MIME_TYPES,
  BOARD_IMAGE_MAX_BYTES,
  BOARD_MAX_ITEMS,
  BOARD_OPS_BATCH_MAX,
  isBoardContainer,
  type Board,
  type BoardColorHex,
  type BoardEdge,
  type BoardItem,
  type BoardItemContent,
  type BoardItemPatchOp,
  type BoardOp,
  type BoardPresenceEntry,
  type BoardTextAlign,
  type ReactionEmoji,
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
  type Edge,
  type EdgeMouseEvent,
  type GraphNode,
  type NodeDragEvent,
  type NodeMouseEvent,
} from '@vue-flow/core';
import {
  computed,
  markRaw,
  nextTick,
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
  EMOJI_DEFAULT_HEIGHT,
  EMOJI_DEFAULT_WIDTH,
  STICKER_DEFAULT_HEIGHT,
  STICKER_DEFAULT_WIDTH,
  fitImageToDefaultBox,
  maxZIndex,
  minZIndex,
  nextZIndexAbove,
  resolveEdgeColor,
  SHAPE_DEFAULT_COLOR,
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
  BOARD_PENDING_EDGE_EDIT_ID_KEY,
  BOARD_PENDING_EDIT_ID_KEY,
} from '../../lib/board/board-canvas-keys';
import { readableTextColor } from '../../lib/board/board-colors';
import type { BoardTextEditorHandle } from '../../lib/board/board-rich-text';
import {
  base64ToFile,
  type BoardClipboardEdge,
  type BoardClipboardItem,
  type BoardClipboardSourceEdge,
  hasActiveTextSelection,
  isPlainTextField,
  parseClipboardPayload,
  serializeSelection,
} from '../../lib/board/board-clipboard';
import { useBoardHotkeys } from '../../lib/board/use-board-hotkeys';
import { FIT_FONT_MAX } from '../../lib/board/use-fit-font-size';
import { toFlowEdges, toFlowNodes } from '../../lib/board/vue-flow-adapter';
import { throttle } from '../../lib/throttle';
import { uuid } from '../../lib/board/uuid';
import {
  BOARD_CAMERA_THROTTLE_MS,
  BOARD_DRAG_THROTTLE_MS,
  BOARD_CURSOR_THROTTLE_MS,
  BOARD_DUPLICATE_OFFSET,
  FRAME_DEFAULT_HEIGHT,
  FRAME_DEFAULT_WIDTH,
} from '../../lib/board/board-constants';
import {
  computeSnapGuides,
  SNAP_THRESHOLD_PX,
  type SnapGuide,
  type SnapRect,
} from '../../lib/board/board-snap';
import { useBoardSessionStore } from '../../stores/board-session';
import { api } from '../../lib/api';
import BoardSelectionToolbar, { type ItemFormKind } from './BoardSelectionToolbar.vue';
import BoardContextMenu, { type BoardContextMenuTarget } from './BoardContextMenu.vue';
import BoardCursor from './BoardCursor.vue';
import BoardEdgeToolbar, {
  type BoardEdgeLineKindOption,
  type BoardEdgeMarkerOption,
} from './BoardEdgeToolbar.vue';
import BoardFloatingEdge from './BoardFloatingEdge.vue';
import BoardImageNode from './BoardImageNode.vue';
import BoardShapeNode from './BoardShapeNode.vue';
import BoardSnapGuides from './BoardSnapGuides.vue';
import BoardStickyNode from './BoardStickyNode.vue';
import BoardTextNode from './BoardTextNode.vue';
import BoardEmojiNode from './BoardEmojiNode.vue';
import BoardStickerNode from './BoardStickerNode.vue';
import BoardToolbar, { type BoardTool } from './BoardToolbar.vue';
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
  const point = flowPositionFromEvent(event);
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

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('paste', onPaste);
  document.addEventListener('copy', onCopy);
});
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('paste', onPaste);
  document.removeEventListener('copy', onCopy);
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

const activeTool = ref<BoardTool>('select');
/** Id только что созданного стикера — новый узел сразу входит в редактирование текста */
const pendingEditId = ref<string | null>(null);
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

function flowPositionFromEvent(event: MouseEvent): { x: number; y: number } {
  const rect = rootEl.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return project({ x: event.clientX - rect.left, y: event.clientY - rect.top });
}

/** Общая проверка перед созданием любого числа элементов — лимит на доску (12.1) один на все типы */
function canCreateItems(count: number): boolean {
  if (!props.canEdit) return false;
  if (props.items.length + count > BOARD_MAX_ITEMS) {
    toast.add({ title: t('board.itemLimitReached'), color: 'error' });
    return false;
  }
  return true;
}

function canCreateItem(): boolean {
  return canCreateItems(1);
}

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

function createSticky(center: { x: number; y: number }): void {
  if (!canCreateItem()) return;
  const id = uuid();
  pendingEditId.value = id;
  void boardSession.applyOps([
    {
      type: 'item.create',
      clientOpId: uuid(),
      item: {
        id,
        parentId: containerAt(center)?.id ?? null,
        x: center.x - STICKY_DEFAULT_WIDTH / 2,
        y: center.y - STICKY_DEFAULT_HEIGHT / 2,
        width: STICKY_DEFAULT_WIDTH,
        height: STICKY_DEFAULT_HEIGHT,
        rotation: 0,
        zIndex: nextZIndexAbove(props.items),
        content: { type: 'sticky', text: '' },
        style: { color: STICKY_DEFAULT_COLOR },
        reactions: [],
      },
    },
  ]);
}

function createShape(center: { x: number; y: number }): void {
  if (!canCreateItem()) return;
  const id = uuid();
  pendingEditId.value = id;
  void boardSession.applyOps([
    {
      type: 'item.create',
      clientOpId: uuid(),
      item: {
        id,
        parentId: containerAt(center)?.id ?? null,
        x: center.x - SHAPE_DEFAULT_WIDTH / 2,
        y: center.y - SHAPE_DEFAULT_HEIGHT / 2,
        width: SHAPE_DEFAULT_WIDTH,
        height: SHAPE_DEFAULT_HEIGHT,
        rotation: 0,
        zIndex: nextZIndexAbove(props.items),
        content: { type: 'shape', shape: 'rectangle', text: '' },
        style: { color: SHAPE_DEFAULT_COLOR },
        reactions: [],
      },
    },
  ]);
}

function createText(center: { x: number; y: number }): void {
  if (!canCreateItem()) return;
  const id = uuid();
  pendingEditId.value = id;
  void boardSession.applyOps([
    {
      type: 'item.create',
      clientOpId: uuid(),
      item: {
        id,
        parentId: containerAt(center)?.id ?? null,
        x: center.x - TEXT_DEFAULT_WIDTH / 2,
        y: center.y - TEXT_DEFAULT_HEIGHT / 2,
        width: TEXT_DEFAULT_WIDTH,
        height: TEXT_DEFAULT_HEIGHT,
        rotation: 0,
        zIndex: nextZIndexAbove(props.items),
        content: { type: 'text', text: '' },
        style: { color: STICKY_DEFAULT_COLOR },
        reactions: [],
      },
    },
  ]);
}

/**
 * Эмодзи (13.3) — единственный «инструмент», у которого нет режима
 * арм+клик-по-холсту: кнопка в `BoardToolbar.vue` сама открывает список,
 * выбор сразу вставляет элемент в центр текущего вьюпорта — тем же приёмом,
 * что paste картинки (`onPaste` ниже), без лишнего клика по пустому месту.
 */
function createEmojiAtCenter(emoji: ReactionEmoji): void {
  breakFollowOnEdit();
  if (!props.canEdit || !canCreateItem()) return;
  const rect = rootEl.value?.getBoundingClientRect();
  if (!rect) return;
  const center = project({ x: rect.width / 2, y: rect.height / 2 });

  const id = uuid();
  void boardSession.applyOps([
    {
      type: 'item.create',
      clientOpId: uuid(),
      item: {
        id,
        parentId: containerAt(center)?.id ?? null,
        x: center.x - EMOJI_DEFAULT_WIDTH / 2,
        y: center.y - EMOJI_DEFAULT_HEIGHT / 2,
        width: EMOJI_DEFAULT_WIDTH,
        height: EMOJI_DEFAULT_HEIGHT,
        rotation: 0,
        zIndex: nextZIndexAbove(props.items),
        content: { type: 'emoji', emoji },
        style: { color: STICKY_DEFAULT_COLOR },
        reactions: [],
      },
    },
  ]);
}

/**
 * Стикер (13.4) — как эмодзи, выбор из поповера сразу вставляет элемент
 * в центр текущего вьюпорта, без промежуточного клика по холсту.
 */
function createStickerAtCenter(pack: string, id: string): void {
  breakFollowOnEdit();
  if (!props.canEdit || !canCreateItem()) return;
  const rect = rootEl.value?.getBoundingClientRect();
  if (!rect) return;
  const center = project({ x: rect.width / 2, y: rect.height / 2 });

  const itemId = uuid();
  void boardSession.applyOps([
    {
      type: 'item.create',
      clientOpId: uuid(),
      item: {
        id: itemId,
        parentId: containerAt(center)?.id ?? null,
        x: center.x - STICKER_DEFAULT_WIDTH / 2,
        y: center.y - STICKER_DEFAULT_HEIGHT / 2,
        width: STICKER_DEFAULT_WIDTH,
        height: STICKER_DEFAULT_HEIGHT,
        rotation: 0,
        zIndex: nextZIndexAbove(props.items),
        content: { type: 'sticker', pack, id },
        style: { color: STICKY_DEFAULT_COLOR },
        reactions: [],
      },
    },
  ]);
}

/**
 * Создание фрейма (14.3) — видимого контейнера с заголовком. Схож с созданием
 * стикера: клик по пустому холсту в режиме инструмента «Фрейм» создаёт его
 * в точке клика и возвращает инструмент на «Выделение».
 */
function createFrame(center: { x: number; y: number }): void {
  if (!canCreateItem()) return;
  const id = uuid();
  pendingEditId.value = id;
  void boardSession.applyOps([
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
        // Фрейм создаётся ПОЗАДИ уже существующих элементов (как в Miro) —
        // иначе он визуально накрывал бы всё, что уже было на доске, заставляя
        // пользователя вручную слать фрейм назад или все остальные элементы вперёд
        zIndex: minZIndex(props.items) - 1,
        content: { type: 'frame', title: '' },
        style: { color: STICKY_DEFAULT_COLOR },
        reactions: [],
      },
    },
  ]);
}

/**
 * Можно сгруппировать: 2+ элемента выделено и среди них НЕТ уже готового
 * контейнера (frame/group) — сервер всё равно отклонит вложенность
 * контейнера в контейнер (без вложенности, 14.3), а без этой проверки
 * оптимистичное применение на клиенте успело бы "съехать", прежде чем батч
 * целиком отклонят и откатят не будет (board-session.ts не откатывает
 * оптимистично применённое на ошибке) — см. также кнопки в BoardContextMenu.
 */
const canGroupSelection = computed(
  () =>
    selectedNodes.value.length >= 2 &&
    !selectedNodes.value.some((n) => isBoardContainer(n.data.content.type)),
);
/** Можно разгруппировать: хотя бы один выделенный элемент сейчас внутри контейнера */
const canUngroupSelection = computed(() =>
  selectedNodes.value.some((n) => n.data.parentId !== null),
);

/**
 * Группировка выделения (14.3) — создаёт невидимую группу (container) и
 * переставляет выделенных элементов `parentId` на неё. Группа позиционируется
 * по bounding box выделения. `x`/`y` элементов в домене остаются абсолютными
 * (не пересчитываются) — относительной позицию для рендера Vue Flow делает
 * `vue-flow-adapter.ts` сам, по разнице с координатами родителя.
 *
 * Это атомарный батч: создали группу + перепривязали всех детей — сервер
 * применит всё по порядку (group.create сначала, потом patches с parentId),
 * так что FK-валидация не будет ругаться на несуществующего родителя.
 */
function groupSelection(): void {
  if (!canGroupSelection.value || !canCreateItem()) return;
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
        zIndex: nextZIndexAbove(props.items),
        content: { type: 'group' },
        style: { color: STICKY_DEFAULT_COLOR },
        reactions: [],
      },
    },
    ...selected.map(
      (node) =>
        ({
          type: 'item.patch',
          clientOpId: uuid(),
          id: node.id,
          patch: { parentId: groupId },
        }) as BoardOp,
    ),
  ];
  void boardSession.applyOps(ops);
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
function ungroupSelection(): void {
  const ops: BoardOp[] = [];
  const dissolvedGroupIds = new Set<string>();
  for (const node of selectedNodes.value) {
    const parentId = node.data.parentId;
    if (parentId === null) continue;
    const parent = props.items.find((candidate) => candidate.id === parentId);
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
      ops.push({ type: 'item.patch', clientOpId: uuid(), id: node.id, patch: { parentId: null } });
    }
  }
  if (ops.length) void boardSession.applyOps(ops);
}

function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = BOARD_IMAGE_ALLOWED_MIME_TYPES.join(',');
    input.style.display = 'none';
    // И выбор файла, и отмена диалога должны убрать за собой скрытый input —
    // иначе при отмене он навсегда остаётся висеть в DOM
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

/** Валидирует и загружает файл на сервер; `null` — ошибка (уже показан тост) */
async function uploadBoardImage(
  file: File,
): Promise<{ url: string; width: number; height: number } | null> {
  // Валидация MIME и размера на клиенте до отправки (сервер тоже проверит)
  const allowedMime: readonly string[] = BOARD_IMAGE_ALLOWED_MIME_TYPES;
  if (!allowedMime.includes(file.type)) {
    toast.add({ title: t('board.imageInvalidType'), color: 'error' });
    return null;
  }
  if (file.size > BOARD_IMAGE_MAX_BYTES) {
    toast.add({ title: t('board.imageTooLarge'), color: 'error' });
    return null;
  }

  const loadingToast = toast.add({ title: t('board.imageUploading'), color: 'info' });
  try {
    const formData = new FormData();
    formData.append('file', file);
    const result = await api.upload<{ url: string; width: number; height: number }>(
      `/api/boards/${props.board.id}/assets`,
      formData,
    );
    toast.remove(loadingToast.id);
    return result;
  } catch (err) {
    toast.remove(loadingToast.id);
    if (err instanceof Error && 'status' in err) {
      const apiErr = err as { status: number; code?: string; message?: string };
      if (apiErr.status === 413) {
        toast.add({ title: t('board.imageTooLarge'), color: 'error' });
      } else if (apiErr.status === 400) {
        toast.add({ title: t('board.imageInvalidType'), color: 'error' });
      } else if (apiErr.status === 403) {
        toast.add({ title: t('board.imageNoPermission'), color: 'error' });
      } else {
        toast.add({ title: t('board.imageUploadFailed'), color: 'error' });
      }
    } else {
      toast.add({ title: t('board.imageUploadFailed'), color: 'error' });
    }
    return null;
  }
}

/** Создаёт элемент-картинку: сначала загружает файл на сервер, затем создаёт элемент с возвращённым URL */
async function createImage(center: { x: number; y: number }, file: File): Promise<void> {
  if (!canCreateItem()) return;
  if (!props.canEdit) return;

  const id = uuid();
  pendingEditId.value = id;

  const result = await uploadBoardImage(file);
  if (!result) return;

  const { width, height } = fitImageToDefaultBox(result.width, result.height);
  void boardSession.applyOps([
    {
      type: 'item.create',
      clientOpId: uuid(),
      item: {
        id,
        parentId: containerAt(center)?.id ?? null,
        x: center.x - width / 2,
        y: center.y - height / 2,
        width,
        height,
        rotation: 0,
        zIndex: nextZIndexAbove(props.items),
        content: { type: 'image', url: result.url, width: result.width, height: result.height },
        style: { color: STICKY_DEFAULT_COLOR },
        reactions: [],
      },
    },
  ]);
}

/**
 * Заменяет файл у уже созданных картинок в выделении (13.2, тулбар выделения) —
 * рамка/позиция на холсте не трогается, меняется только содержимое `<img>`
 * (как замена картинки в Miro). Не-картинки в смешанном выделении пропускаются.
 */
async function replaceSelectedImage(): Promise<void> {
  if (!props.canEdit) return;
  const file = await pickImageFile();
  if (!file) return;
  const result = await uploadBoardImage(file);
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
  if (ops.length) void boardSession.applyOps(ops);
}

/** Инструмент «Стикер»/«Фигура»/«Текст»/«Картинка» — следующий одиночный клик по пустому холсту создаёт элемент и там же.
 * Для картинки — открывает файловый диалог (как нативный input type=file), так как
 * клик сам по себе не несёт файла. Эмодзи в этот список не входит — у него
 * нет режима «инструмент+клик», см. `createEmojiAtCenter`. Drop и Paste
 * работают всегда независимо от инструмента.
 */
function onPaneClick(event: MouseEvent): void {
  // Клик пустым инструментом (select/arrow) ничего не создаёт и не редактирует —
  // follow-mode рвать незачем, иначе обычный клик для снятия выделения во время
  // слежения обрывал бы его без какого-либо реального вмешательства в доску
  if (
    activeTool.value !== 'sticky' &&
    activeTool.value !== 'shape' &&
    activeTool.value !== 'text' &&
    activeTool.value !== 'image' &&
    activeTool.value !== 'frame'
  ) {
    return;
  }
  breakFollowOnEdit();
  if (activeTool.value === 'sticky') {
    createSticky(flowPositionFromEvent(event));
  } else if (activeTool.value === 'shape') {
    createShape(flowPositionFromEvent(event));
  } else if (activeTool.value === 'text') {
    createText(flowPositionFromEvent(event));
  } else if (activeTool.value === 'image') {
    const position = flowPositionFromEvent(event);
    activeTool.value = 'select';
    void pickImageFile().then((file) => {
      if (file) void createImage(position, file);
    });
    return;
  } else if (activeTool.value === 'frame') {
    createFrame(flowPositionFromEvent(event));
  }
  activeTool.value = 'select';
}

/**
 * Двойной клик — всегда доступное быстрое создание, независимо от активного
 * инструмента. Vue Flow не отдаёт отдельное событие двойного клика по пане
 * (только по узлам), поэтому слушаем нативный dblclick сами — и обязательно
 * в фазе перехвата (`.capture`): сам Vue Flow гасит всплытие клика по пане
 * своим внутренним обработчиком (жестовая логика pan/selection), так что
 * обычный `@dblclick` на предке никогда бы не сработал. Проверка класса цели
 * отсекает клики по узлу/панели/тулбару — у них есть собственный DOM поверх
 * фона пане.
 */
function onPaneDoubleClick(event: MouseEvent): void {
  if (!(event.target as HTMLElement).classList.contains('vue-flow__pane')) return;
  breakFollowOnEdit();
  createSticky(flowPositionFromEvent(event));
}

/** Drag & Drop файла на канвас — создаёт элемент-картинку в месте курсора */
function onPaneDrop(event: DragEvent): void {
  if (!props.canEdit) return;
  breakFollowOnEdit();
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) {
    createImage(flowPositionFromEvent(event), file);
  }
}

/** Drag over — нужен, чтобы браузер разрешил drop */
function onPaneDragOver(event: DragEvent): void {
  if (!props.canEdit) return;
  event.preventDefault();
  // Визуальная индикация (опционально) — можно добавить класс на rootEl
}

/**
 * Вставка (Ctrl/Cmd+V) — сначала пробуем наш формат (элементы доски, в т.ч.
 * скопированные с другой доски), иначе — как раньше, картинка из ОС-буфера.
 * В настоящих текстовых полях (input URL-ссылки) наш формат не перехватываем
 * никогда. Текст стикера/фигуры — `contenteditable` всегда, а не только в
 * момент активного редактирования, так что фокус там стоит и после обычного
 * клика на выделение элемента — но раз распознали наш JSON в буфере, значит
 * пользователь только что скопировал именно элемент доски, а не текст; вставлять
 * этот JSON как есть в contenteditable всё равно было бы бессмысленно.
 */
function onPaste(event: ClipboardEvent): void {
  if (!props.canEdit) return;

  if (!isPlainTextField(event.target)) {
    const text = event.clipboardData?.getData('text/plain');
    const payload = text ? parseClipboardPayload(text) : null;
    if (payload) {
      event.preventDefault();
      void pasteBoardItems(payload.items, payload.edges);
      return;
    }
  }

  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      const file = item.getAsFile();
      if (file) {
        // Центр текущего вьюпорта — используем размеры rootEl
        const rect = rootEl.value?.getBoundingClientRect();
        if (rect) {
          const center = project({ x: rect.width / 2, y: rect.height / 2 });
          createImage(center, file);
        }
      }
      break;
    }
  }
}

/**
 * Копирование выделения в системный буфер (Ctrl/Cmd+C, 13.5). Пишем через
 * `navigator.clipboard.writeText` (не `event.clipboardData.setData`) —
 * сериализация картинок асинхронная (fetch байтов), а `clipboardData` из
 * события валиден для записи только синхронно в момент диспатча события,
 * запись после `await` в браузере молча не сработает.
 *
 * Не используем общий `isEditableTarget` из хоткеев: текст стикера/фигуры —
 * `contenteditable` всегда, а не только в момент активного редактирования,
 * так что он получает фокус уже от одного клика на выделение элемента —
 * `isEditableTarget` был бы true почти всегда, когда что-то выделено, и
 * Ctrl+C никогда бы не копировал элемент. Настоящий сигнал «пользователь
 * хочет скопировать именно текст» — протянутое (не коллапсированное)
 * текстовое выделение, см. `hasActiveTextSelection`.
 */
async function onCopy(event: ClipboardEvent): Promise<void> {
  if (!props.canEdit) return;
  if (isPlainTextField(event.target) || hasActiveTextSelection()) return;

  const selected = selectedNodes.value;
  if (!selected.length) return;
  event.preventDefault();

  const sourceItems = expandContainerFamily(selected);
  const sourceIds = new Set(sourceItems.map((item) => item.id));
  // Только рёбра, у которых ОБА конца входят в копируемый набор — Miro-подобное
  // поведение: связь с элементом ВНЕ выделения не переносится (некуда её вести)
  const sourceEdges = props.edges.filter(
    (edge) => sourceIds.has(edge.sourceItemId) && sourceIds.has(edge.targetItemId),
  );

  const payload = await serializeSelection(
    sourceItems.map((item) => ({
      id: item.id,
      parentId: item.parentId,
      content: item.content,
      style: item.style,
      rotation: item.rotation,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    })),
    sourceEdges.map((edge): BoardClipboardSourceEdge => ({
      sourceItemId: edge.sourceItemId,
      targetItemId: edge.targetItemId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      style: edge.style,
    })),
  );
  try {
    await navigator.clipboard.writeText(payload);
  } catch {
    // Буфер недоступен (нет прав/небезопасный контекст) — молча игнорируем
  }
}

/** Вставка элементов доски из буфера (наш формат, 13.5) — работает и между досками */
async function pasteBoardItems(
  items: BoardClipboardItem[],
  edges: BoardClipboardEdge[],
): Promise<void> {
  breakFollowOnEdit();
  if (!props.canEdit || !items.length) return;
  if (!canCreateItems(items.length)) return;
  if (!canApplyOpsCount(items.length + edges.length)) return;

  const rect = rootEl.value?.getBoundingClientRect();
  if (!rect) return;
  const viewportCenter = project({ x: rect.width / 2, y: rect.height / 2 });
  const baseZIndex = maxZIndex(props.items) + 1;
  const ops: BoardOp[] = [];
  // Индексировано по ПОЗИЦИИ В ИСХОДНОМ items (не по порядку успешных вставок) —
  // parentIndex в payload ссылается на исходные позиции; пропущенный элемент
  // (например, картинку не удалось перезалить) оставляет в массиве дыру,
  // но контейнером (целью parentIndex) картинка быть не может, так что это безопасно
  const newIds: (string | undefined)[] = new Array(items.length);

  for (const [index, item] of items.entries()) {
    let content: BoardItemContent;
    let width = item.width;
    let height = item.height;

    if (item.content.type === 'image') {
      // Картинка board-scoped на сервере — байты из буфера грузим как новый ассет текущей доски
      const file = base64ToFile(item.content.base64, item.content.mimeType, `${uuid()}.webp`);
      const result = await uploadBoardImage(file);
      if (!result) continue;
      const fitted = fitImageToDefaultBox(result.width, result.height);
      width = fitted.width;
      height = fitted.height;
      content = { type: 'image', url: result.url, width: result.width, height: result.height };
    } else {
      content = item.content;
    }

    const id = uuid();
    newIds[index] = id;
    const x = viewportCenter.x + item.relX - width / 2;
    const y = viewportCenter.y + item.relY - height / 2;
    // Родитель — контейнер (frame/group), тоже скопированный в этом же payload
    // (14.3, восстанавливаем структуру), иначе — фрейм, в который попал центр
    // при вставке (как и при обычном создании); контейнер сам не вкладывается
    const parentId = isBoardContainer(content.type)
      ? null
      : item.parentIndex !== null
        ? (newIds[item.parentIndex] ?? null)
        : (containerAt({ x: x + width / 2, y: y + height / 2 })?.id ?? null);
    ops.push({
      type: 'item.create',
      clientOpId: uuid(),
      item: {
        id,
        parentId,
        x,
        y,
        width,
        height,
        rotation: item.rotation,
        zIndex: baseZIndex + index,
        content,
        style: item.style,
        reactions: [],
      },
    });
  }

  for (const edge of edges) {
    const sourceItemId = newIds[edge.sourceIndex];
    const targetItemId = newIds[edge.targetIndex];
    // Один из концов не вставился (например, картинку не удалось перезалить) —
    // рёбро в никуда не создаём
    if (!sourceItemId || !targetItemId) continue;
    ops.push({
      type: 'edge.create',
      clientOpId: uuid(),
      edge: {
        id: uuid(),
        sourceItemId,
        targetItemId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        label: edge.label,
        style: edge.style,
      },
    });
  }

  if (!ops.length) return;
  void boardSession.applyOps(ops);
  // Вставленные элементы сразу остаются выделенными (как в Miro) — иначе
  // пришлось бы заново выделять их, чтобы подвинуть на нужное место (13.5).
  // `setNodes` из `watch(flowNodes, ...)` применяется реактивно, не синхронно —
  // ждём тика, иначе Vue Flow ещё не знает о только что созданных узлах
  await nextTick();
  removeSelectedNodes(getSelectedNodes.value);
  addSelectedNodes(newIds.map((id) => ({ id }) as GraphNode<BoardItem>));
}

// --- Перетаскивание: локально холст двигает сам Vue Flow, по сети —
// throttled-патчи на каждый кадр драга плюс гарантированный финальный на
// dragstop (12.6). Троттлер свой на элемент — иначе при мультивыборе только
// последний по порядку элемент кадра реально долетал бы до сети.
const dragThrottlers = new Map<string, (node: GraphNode<BoardItem>) => void>();

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

function childrenOf(containerId: string): BoardItem[] {
  return props.items.filter((candidate) => candidate.parentId === containerId);
}

/**
 * Полный набор элементов для копирования/дублирования выделения (14.3):
 * выделение плюс всё, что должно "приехать вместе" с ним, даже если не было
 * явно выделено само:
 * - выделен контейнер (frame/group) → тянем его детей (иначе копия/дубликат
 *   контейнера была бы пустой оболочкой);
 * - выделен участник ГРУППЫ (не фрейма) → тянем саму группу-контейнер и ВСЕХ
 *   остальных участников — группа жёсткий пучок, копируется только целиком,
 *   даже если явно выделен был всего один её участник (как при разгруппировке,
 *   см. ungroupSelection). Фрейм — не то же самое: выделенный ОДИНОЧНЫЙ его
 *   ребёнок копируется сам по себе, без остальных детей фрейма и самого фрейма.
 */
function expandContainerFamily(selected: readonly GraphNode<BoardItem>[]): BoardItem[] {
  const selectedIds = new Set(selected.map((n) => n.id));
  const extra = new Map<string, BoardItem>();
  for (const node of selected) {
    if (isBoardContainer(node.data.content.type)) {
      for (const child of childrenOf(node.id)) {
        if (!selectedIds.has(child.id)) extra.set(child.id, child);
      }
      continue;
    }
    if (node.data.parentId !== null) {
      const parent = props.items.find((candidate) => candidate.id === node.data.parentId);
      if (parent?.content.type === 'group') {
        if (!selectedIds.has(parent.id)) extra.set(parent.id, parent);
        for (const mate of childrenOf(parent.id)) {
          if (!selectedIds.has(mate.id)) extra.set(mate.id, mate);
        }
      }
    }
  }
  return [...selected.map((n) => n.data), ...extra.values()].sort(
    (a, b) => Number(isBoardContainer(a.content.type)) - Number(isBoardContainer(b.content.type)),
  );
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

// --- Плавающий тулбар над выделением (12.6) ---

const selectedNodes = computed(() => getSelectedNodes.value as GraphNode<BoardItem>[]);
const selectedEdges = computed(() => getSelectedEdges.value as Edge<BoardEdge>[]);

const selectionToolbarPosition = computed(() => {
  const selected = selectedNodes.value;
  if (!props.canEdit || selected.length === 0) return null;
  const left = Math.min(...selected.map((node) => node.computedPosition.x));
  const right = Math.max(
    ...selected.map((node) => node.computedPosition.x + node.dimensions.width),
  );
  const top = Math.min(...selected.map((node) => node.computedPosition.y));
  return {
    left: viewport.value.x + ((left + right) / 2) * viewport.value.zoom,
    top: viewport.value.y + top * viewport.value.zoom,
  };
});

const edgeToolbarPosition = computed(() => {
  const selected = selectedEdges.value;
  if (!props.canEdit || selected.length === 0) return null;
  const nodes = getNodes.value;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edge = selected[0]!;
  const sourceNode = nodeMap.get(edge.source);
  const targetNode = nodeMap.get(edge.target);
  if (!sourceNode || !targetNode) return null;
  const x = (sourceNode.position.x + targetNode.position.x) / 2;
  const y = (sourceNode.position.y + targetNode.position.y) / 2;
  return {
    left: viewport.value.x + x * viewport.value.zoom,
    top: viewport.value.y + y * viewport.value.zoom,
  };
});

const selectedEdgeStyle = computed<BoardEdge['style']>(() => {
  const style = selectedEdges.value[0]?.data?.style;
  if (style) return style;
  return { line: 'curved', markerStart: 'none', markerEnd: 'arrow' };
});

/** Кружок-триггер в тулбаре связи всегда нужен литеральным цветом (12.9) — резолвим авто */
const selectedEdgeColor = computed<BoardColorHex>(() =>
  resolveEdgeColor(selectedEdgeStyle.value.color),
);

function patchSelected(patchByNode: (node: GraphNode<BoardItem>, index: number) => BoardOp): void {
  const ops = selectedNodes.value.map(patchByNode);
  if (ops.length) void boardSession.applyOps(ops);
}

function patchSelectedEdge(patchByEdge: (edge: Edge<BoardEdge>) => BoardOp): void {
  const ops = selectedEdges.value.map(patchByEdge);
  if (ops.length) void boardSession.applyOps(ops);
}

function patchEdgeLine(line: BoardEdgeLineKindOption): void {
  patchSelectedEdge((edge) => {
    const data = edge.data as BoardEdge;
    return {
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...data.style, line } },
    };
  });
}

function patchEdgeMarkerStart(marker: BoardEdgeMarkerOption): void {
  patchSelectedEdge((edge) => {
    const data = edge.data as BoardEdge;
    return {
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...data.style, markerStart: marker } },
    };
  });
}

function patchEdgeMarkerEnd(marker: BoardEdgeMarkerOption): void {
  patchSelectedEdge((edge) => {
    const data = edge.data as BoardEdge;
    return {
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...data.style, markerEnd: marker } },
    };
  });
}

function patchEdgeColor(color: BoardColorHex): void {
  patchSelectedEdge((edge) => {
    const data = edge.data as BoardEdge;
    return {
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...data.style, color } },
    };
  });
}

/** Текст подписи пишется прямо на стрелке (12.8, паттерн Miro), не в тулбаре — тулбар
 * лишь открывает этот ввод, чтобы кнопка «текст» была доступна и без двойного клика */
function addTextToSelectedEdge(): void {
  const edge = selectedEdges.value[0];
  if (edge) pendingEdgeEditId.value = edge.id;
}

function onEdgeDoubleClick({ edge }: EdgeMouseEvent): void {
  if (!props.canEdit) return;
  pendingEdgeEditId.value = edge.id;
}

function deleteSelectedEdges(): void {
  patchSelectedEdge((edge) => ({
    type: 'edge.delete',
    clientOpId: uuid(),
    id: edge.id,
  }));
}

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
  () => selectedNodes.value[0]?.data.style.color ?? STICKY_DEFAULT_COLOR,
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
  patchSelected((node) => ({
    type: 'item.patch',
    clientOpId: uuid(),
    id: node.id,
    patch: { style: { color } },
  }));
}

/** Верхняя граница авто-fit (12.9) — не задана в style, показываем эффективный дефолт (FIT_FONT_MAX) */
const selectedFontSize = computed<number>(
  () => selectedNodes.value[0]?.data.style.fontSize ?? FIT_FONT_MAX,
);
const selectedTextColor = computed<BoardColorHex>(
  () => selectedNodes.value[0]?.data.style.textColor ?? readableTextColor(selectedColor.value),
);
const selectedTextAlign = computed<BoardTextAlign>(
  () => selectedNodes.value[0]?.data.style.textAlign ?? 'center',
);

function setSelectedFontSize(fontSize: number): void {
  patchSelected((node) => ({
    type: 'item.patch',
    clientOpId: uuid(),
    id: node.id,
    patch: { style: { fontSize } },
  }));
}

function setSelectedTextColor(textColor: BoardColorHex): void {
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
  if (ops.length) void boardSession.applyOps(ops);
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
  if (ops.length) void boardSession.applyOps(ops);
}

/**
 * Дублирование (12.9) — копия content/style с офсетом позиции (Miro), встаёт
 * поверх всех. Фрейм/группа (14.3) — мини-холст: дублируя контейнер, тянем за
 * собой и его детей, даже если явно выделен был только сам контейнер —
 * иначе копия фрейма оставалась бы пустой, а оригинал молча терял детей
 * (при этом явно выделенный вместе с контейнером ребёнок не дублируется дважды).
 * Дубликат ребёнка, чей контейнер НЕ дублируется вместе с ним (дублировали
 * только сам элемент), остаётся прикреплён к ТОМУ ЖЕ оригинальному контейнеру —
 * это ожидаемо (Miro): дубликат карточки внутри фрейма остаётся внутри фрейма.
 * Контейнеры сортируются первыми — сервер применяет батч по порядку и
 * отклонил бы item.create ребёнка со ссылкой на ещё не созданный дубликат-родитель.
 */
function duplicateSelected(): void {
  const selected = selectedNodes.value;
  if (!selected.length) return;
  breakFollowOnEdit();
  const sourceItems = expandContainerFamily(selected);
  if (!sourceItems.length || !canCreateItems(sourceItems.length)) return;
  const sourceIds = new Set(sourceItems.map((item) => item.id));
  const sourceEdges = props.edges.filter(
    (edge) => sourceIds.has(edge.sourceItemId) && sourceIds.has(edge.targetItemId),
  );
  if (!canApplyOpsCount(sourceItems.length + sourceEdges.length)) return;
  const base = maxZIndex(props.items) + 1;
  const idMap = new Map(sourceItems.map((source) => [source.id, uuid()]));
  const itemOps: BoardOp[] = sourceItems.map(
    (source, index) =>
      ({
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id: idMap.get(source.id)!,
          parentId:
            source.parentId !== null ? (idMap.get(source.parentId) ?? source.parentId) : null,
          x: source.x + BOARD_DUPLICATE_OFFSET,
          y: source.y + BOARD_DUPLICATE_OFFSET,
          width: source.width,
          height: source.height,
          rotation: source.rotation,
          zIndex: base + index,
          content: source.content,
          style: source.style,
          reactions: [],
        },
      }) satisfies BoardOp,
  );
  const edgeOps: BoardOp[] = sourceEdges.map(
    (edge) =>
      ({
        type: 'edge.create',
        clientOpId: uuid(),
        edge: {
          id: uuid(),
          sourceItemId: idMap.get(edge.sourceItemId)!,
          targetItemId: idMap.get(edge.targetItemId)!,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          label: edge.label,
          style: edge.style,
        },
      }) satisfies BoardOp,
  );
  void boardSession.applyOps([...itemOps, ...edgeOps]);
}

function bringSelectedToFront(): void {
  const base = maxZIndex(props.items) + 1;
  patchSelected((node, index) => ({
    type: 'item.patch',
    clientOpId: uuid(),
    id: node.id,
    patch: { zIndex: base + index },
  }));
}

function sendSelectedToBack(): void {
  const base = minZIndex(props.items) - selectedNodes.value.length;
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

// --- Контекстное меню по правой кнопке (12.9) ---

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
  const rect = rootEl.value?.getBoundingClientRect();
  const point = event instanceof MouseEvent ? event : event.touches[0];
  if (!rect || !point) return { left: 0, top: 0 };
  return { left: point.clientX - rect.left, top: point.clientY - rect.top };
}

/**
 * Прямая мутация `.selected` на узлах/связях вместо `addSelectedNodes`/
 * `removeSelectedElements` из `useVueFlow()` (12.9) — на связке `:only-render-
 * visible-elements="true"` + собственный `setNodes`-синк (см. комментарий выше
 * про watch(flowNodes)) эти хелперы иногда уходят в ветку `multiSelectionActive`,
 * которая только эмитит событие `nodesChange`/`edgesChange`, ничего не мутируя
 * сама — и в момент вызова (например, сразу после program­матического клика в
 * тестах) реального слушателя на это событие не оказывается, снятие/установка
 * выделения молча не срабатывает. `node.selected`/`edge.selected` — обычные
 * реактивные поля тех же объектов, что рендерит Vue Flow (подтверждено по
 * исходникам библиотеки: `getNodesInside`/`nodeLookup` работают с одними и
 * теми же ссылками) — мутировать их напрямую надёжнее и не зависит от этой
 * внутренней ветки.
 */
function selectOnlyNode(node: GraphNode<BoardItem>): void {
  for (const n of getNodes.value) n.selected = n.id === node.id;
  for (const e of getEdges.value) e.selected = false;
}

function selectOnlyEdge(edge: Edge<BoardEdge>): void {
  for (const n of getNodes.value) n.selected = false;
  for (const e of getEdges.value) e.selected = e.id === edge.id;
}

function selectAllElements(): void {
  for (const n of getNodes.value) n.selected = true;
  for (const e of getEdges.value) e.selected = true;
}

function clearAllSelection(): void {
  for (const n of getNodes.value) n.selected = false;
  for (const e of getEdges.value) e.selected = false;
}

/**
 * Клик по узлу-контейнеру (frame/group, 14.3), пока активен инструмент
 * создания элемента. Vue Flow гасит `pane-click` для клика по ЛЮБОМУ узлу
 * (иначе нельзя было бы отличить «кликнули по карточке» от «кликнули по
 * пустому месту») — фрейм визуально выглядит как пустая область мини-холста,
 * но физически это узел Vue Flow поверх пейна, так что обычный `onPaneClick`
 * никогда не сработал бы для клика ВНУТРИ уже существующего фрейма. Без этого
 * обработчика инструмент «Стикер»/«Фигура»/... молча ничего не создавал бы
 * при клике внутри фрейма — именно та точка, где элемент должен приклеиться
 * к нему автоматически (см. containerAt).
 */
function onNodeClick({ event, node }: NodeMouseEvent): void {
  if (activeTool.value === 'select') return;
  if (!isBoardContainer((node as GraphNode<BoardItem>).data.content.type)) return;
  if (!(event instanceof MouseEvent)) return;
  onPaneClick(event);
}

function onNodeContextMenu({ event, node }: NodeMouseEvent): void {
  if (!props.canEdit) return;
  (event as MouseEvent).preventDefault();
  // Правый клик по НЕвыделенной карточке заменяет выделение ей (как в Figma/Miro) —
  // иначе меню применялось бы не к той карточке, на которую кликнули
  if (!node.selected) selectOnlyNode(node as GraphNode<BoardItem>);
  contextMenu.value = { target: 'item', ...contextMenuPositionFromEvent(event) };
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
function onSelectionContextMenu({
  event,
}: {
  event: MouseEvent;
  nodes: GraphNode<BoardItem>[];
}): void {
  if (!props.canEdit) return;
  event.preventDefault();
  contextMenu.value = { target: 'item', ...contextMenuPositionFromEvent(event) };
}

function onEdgeContextMenu({ event, edge }: EdgeMouseEvent): void {
  if (!props.canEdit) return;
  (event as MouseEvent).preventDefault();
  if (!edge.selected) selectOnlyEdge(edge as Edge<BoardEdge>);
  contextMenu.value = { target: 'edge', ...contextMenuPositionFromEvent(event) };
}

/** Пустой холст — своего меню нет (см. `BoardContextMenu.vue`), но браузерное всё равно гасим */
function onPaneContextMenu(event: MouseEvent): void {
  event.preventDefault();
  contextMenu.value = null;
}

function closeContextMenu(): void {
  contextMenu.value = null;
}

// --- Хоткеи (12.9): Delete/Backspace, Ctrl(Cmd)+A/D/0/1, Escape; +Z/Shift+Z/Y (12.10) ---

useBoardHotkeys({
  canEdit: computed(() => props.canEdit),
  deleteSelection: () => {
    deleteSelected();
    deleteSelectedEdges();
  },
  duplicateSelection: duplicateSelected,
  selectAll: selectAllElements,
  clearSelection: () => {
    clearAllSelection();
    contextMenu.value = null;
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
        :current-text-color="selectedTextColor"
        :current-text-align="selectedTextAlign"
        :editing-text="!!activeTextEditor"
        :active-marks="activeTextEditor?.activeMarks.value ?? null"
        @color="setSelectedColor"
        @form="setSelectedForm"
        @font-size="setSelectedFontSize"
        @text-color="setSelectedTextColor"
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
