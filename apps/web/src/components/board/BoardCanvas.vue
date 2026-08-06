<script setup lang="ts">
/**
 * Холст доски поверх Vue Flow. Раскладка управления по Miro: колесо — пан,
 * Ctrl/Cmd+колесо и пинч — зум, средняя кнопка мыши или зажатый пробел+ЛКМ —
 * пан, drag по пустому холсту ЛКМ — рамка мультивыбора (12.5).
 *
 * Создание/перетаскивание/резайз/редактирование/цвет/слои/удаление стикеров —
 * 12.6, с оптимистичным применением через `stores/board-session.ts`. Создать
 * можно двумя жестами (оба из макета): двойной клик по холсту в любой момент,
 * или выбрать инструмент «Стикер» в левом тулбаре — следующий одиночный клик
 * по холсту создаёт стикер там и возвращает инструмент обратно на «Выделение».
 *
 * Визуальный язык — по референсу `.design/main.html` (экран "Доска"). Из
 * референса сознательно НЕ взяты: остальные 5 иконок левого тулбара
 * (фигура/стрелка/текст/картинка/эмодзи — 12.7+), порядок слоёв показан в
 * плавающем тулбаре выделения, а не в ещё не реализованном контекстном меню
 * (12.9), настройка размера шрифта вынесена в отдельную будущую задачу
 * (решение пользователя 06.08.2026), «Дублировать» не входит в объём 12.6.
 */
import {
  BOARD_MAX_ITEMS,
  type Board,
  type BoardColorToken,
  type BoardEdge,
  type BoardItem,
  type BoardOp,
} from '@poker/shared';
import type { DropdownMenuItem } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { Background } from '@vue-flow/background';
import { ControlButton, Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import { Panel, useVueFlow, VueFlow, type GraphNode, type NodeDragEvent } from '@vue-flow/core';
import {
  computed,
  markRaw,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  useTemplateRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';

import {
  maxZIndex,
  minZIndex,
  nextZIndexAbove,
  STICKY_DEFAULT_COLOR,
  STICKY_DEFAULT_HEIGHT,
  STICKY_DEFAULT_WIDTH,
} from '../../lib/board/board-item-defaults';
import { BOARD_CAN_EDIT_KEY, BOARD_PENDING_EDIT_ID_KEY } from '../../lib/board/board-canvas-keys';
import { toFlowEdges, toFlowNodes } from '../../lib/board/vue-flow-adapter';
import { throttle } from '../../lib/throttle';
import { useBoardSessionStore } from '../../stores/board-session';
import BoardSelectionToolbar from './BoardSelectionToolbar.vue';
import BoardShapeNode from './BoardShapeNode.vue';
import BoardStickyNode from './BoardStickyNode.vue';
import BoardToolbar, { type BoardTool } from './BoardToolbar.vue';

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
}>();

const { t } = useI18n();
const toast = useToast();
const boardSession = useBoardSessionStore();

const flowNodes = computed(() => toFlowNodes(props.items));
const flowEdges = computed(() => toFlowEdges(props.edges));

// markRaw — иначе Vue оборачивает объект с компонентами в reactive() и предупреждает
// об этом в консоли (компонент-конструктор реактивным быть не должен)
const nodeTypes = markRaw({ sticky: BoardStickyNode, shape: BoardShapeNode });

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

const { viewport, project, getSelectedNodes, setNodes, setEdges } = useVueFlow();
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
 */
watch(flowNodes, (next) => setNodes(next), { immediate: true });
watch(flowEdges, (next) => setEdges(next), { immediate: true });

const rootEl = useTemplateRef<HTMLElement>('root');
const isFullscreen = ref(false);

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

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange));
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreenChange));

// --- Инструменты и создание стикеров (12.6) ---

const activeTool = ref<BoardTool>('select');
/** Id только что созданного стикера — новый узел сразу входит в редактирование текста */
const pendingEditId = ref<string | null>(null);
provide(
  BOARD_CAN_EDIT_KEY,
  computed(() => props.canEdit),
);
provide(BOARD_PENDING_EDIT_ID_KEY, pendingEditId);

function flowPositionFromEvent(event: MouseEvent): { x: number; y: number } {
  const rect = rootEl.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return project({ x: event.clientX - rect.left, y: event.clientY - rect.top });
}

function createSticky(center: { x: number; y: number }): void {
  if (!props.canEdit) return;
  if (props.items.length >= BOARD_MAX_ITEMS) {
    toast.add({ title: t('board.itemLimitReached'), color: 'error' });
    return;
  }
  const id = crypto.randomUUID();
  pendingEditId.value = id;
  void boardSession.applyOps([
    {
      type: 'item.create',
      clientOpId: crypto.randomUUID(),
      item: {
        id,
        parentId: null,
        x: center.x - STICKY_DEFAULT_WIDTH / 2,
        y: center.y - STICKY_DEFAULT_HEIGHT / 2,
        width: STICKY_DEFAULT_WIDTH,
        height: STICKY_DEFAULT_HEIGHT,
        rotation: 0,
        zIndex: nextZIndexAbove(props.items),
        content: { type: 'sticky', text: '' },
        style: { color: STICKY_DEFAULT_COLOR },
      },
    },
  ]);
}

/** Инструмент «Стикер» — следующий одиночный клик по пустому холсту создаёт стикер и там же */
function onPaneClick(event: MouseEvent): void {
  if (activeTool.value !== 'sticky') return;
  createSticky(flowPositionFromEvent(event));
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
  createSticky(flowPositionFromEvent(event));
}

// --- Перетаскивание: локально холст двигает сам Vue Flow, по сети —
// throttled-патчи на каждый кадр драга плюс гарантированный финальный на
// dragstop (12.6). Троттлер свой на элемент — иначе при мультивыборе только
// последний по порядку элемент кадра реально долетал бы до сети.
const dragThrottlers = new Map<string, (node: GraphNode<BoardItem>) => void>();

function sendPositionPatch(node: GraphNode<BoardItem>): void {
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: crypto.randomUUID(),
      id: node.id,
      patch: { x: node.computedPosition.x, y: node.computedPosition.y },
    },
  ]);
}

function onNodeDrag({ nodes: dragged }: NodeDragEvent): void {
  for (const node of dragged as GraphNode<BoardItem>[]) {
    let send = dragThrottlers.get(node.id);
    if (!send) {
      send = throttle(sendPositionPatch, 80);
      dragThrottlers.set(node.id, send);
    }
    send(node);
  }
}

function onNodeDragStop({ nodes: dragged }: NodeDragEvent): void {
  for (const node of dragged as GraphNode<BoardItem>[]) sendPositionPatch(node);
}

// --- Плавающий тулбар над выделением (12.6) ---

const selectedNodes = computed(() => getSelectedNodes.value as GraphNode<BoardItem>[]);

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

function patchSelected(patchByNode: (node: GraphNode<BoardItem>, index: number) => BoardOp): void {
  const ops = selectedNodes.value.map(patchByNode);
  if (ops.length) void boardSession.applyOps(ops);
}

function setSelectedColor(color: BoardColorToken): void {
  patchSelected((node) => ({
    type: 'item.patch',
    clientOpId: crypto.randomUUID(),
    id: node.id,
    patch: { style: { color } },
  }));
}

function bringSelectedToFront(): void {
  const base = maxZIndex(props.items) + 1;
  patchSelected((node, index) => ({
    type: 'item.patch',
    clientOpId: crypto.randomUUID(),
    id: node.id,
    patch: { zIndex: base + index },
  }));
}

function sendSelectedToBack(): void {
  const base = minZIndex(props.items) - selectedNodes.value.length;
  patchSelected((node, index) => ({
    type: 'item.patch',
    clientOpId: crypto.randomUUID(),
    id: node.id,
    patch: { zIndex: base + index },
  }));
}

function deleteSelected(): void {
  patchSelected((node) => ({
    type: 'item.delete',
    clientOpId: crypto.randomUUID(),
    id: node.id,
  }));
}
</script>

<template>
  <div
    ref="root"
    class="board-canvas-root h-full w-full bg-[var(--ui-bg)]"
    :class="{ 'board-canvas-sticky-armed': activeTool === 'sticky' }"
    @dblclick.capture="onPaneDoubleClick"
  >
    <VueFlow
      :node-types="nodeTypes"
      :nodes-draggable="canEdit"
      :nodes-connectable="false"
      :pan-on-drag="[1]"
      selection-on-drag
      :pan-on-scroll="true"
      :zoom-on-scroll="false"
      :zoom-on-pinch="true"
      snap-to-grid
      :snap-grid="[8, 8]"
      :min-zoom="0.1"
      :max-zoom="2"
      :only-render-visible-elements="true"
      fit-view-on-init
      @pane-click="onPaneClick"
      @node-drag="onNodeDrag"
      @node-drag-stop="onNodeDragStop"
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

      <BoardToolbar v-if="canEdit" v-model="activeTool" />

      <BoardSelectionToolbar
        v-if="selectionToolbarPosition"
        :left="selectionToolbarPosition.left"
        :top="selectionToolbarPosition.top"
        @color="setSelectedColor"
        @bring-to-front="bringSelectedToFront"
        @send-to-back="sendSelectedToBack"
        @delete="deleteSelected"
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
  </div>
</template>

<style scoped>
.board-canvas-root:fullscreen {
  width: 100vw;
  height: 100vh;
}

.board-canvas-sticky-armed :deep(.vue-flow__pane) {
  cursor: crosshair;
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
</style>
