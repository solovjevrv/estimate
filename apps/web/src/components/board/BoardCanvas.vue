<script setup lang="ts">
/**
 * Холст доски поверх Vue Flow (12.5) — только рендер снимка. Раскладка
 * управления по Miro: колесо — пан, Ctrl/Cmd+колесо и пинч — зум, средняя
 * кнопка мыши или зажатый пробел+ЛКМ — пан, drag по пустому холсту ЛКМ —
 * рамка мультивыбора. Создание/перетаскивание элементов — 12.6+.
 *
 * Визуальный язык (плашка названия, кластер управления) — по референсу
 * `.design/main.html` (экран "Доска", добавлен 06.08.2026). Из референса
 * сознательно НЕ взяты: левый тулбар инструментов (12.9 — сейчас нечем
 * создавать элементы), пункты меню "Дублировать"/"Экспорт в PNG" (нет
 * реализации — 15.5 и не заведённая задача), пустое состояние с иллюстрацией
 * и подсказкой "дважды кликните" (подсказка про действие, которого пока
 * не существует, — появится вместе с созданием стикеров в 12.6).
 */
import type { Board, BoardEdge, BoardItem } from '@poker/shared';
import type { DropdownMenuItem } from '@nuxt/ui';
import { Background } from '@vue-flow/background';
import { ControlButton, Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import { Panel, useVueFlow, VueFlow } from '@vue-flow/core';
import { computed, markRaw, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';

import { toFlowEdges, toFlowNodes } from '../../lib/board/vue-flow-adapter';
import BoardShapeNode from './BoardShapeNode.vue';
import BoardStickyNode from './BoardStickyNode.vue';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

const props = defineProps<{
  board: Board;
  /** Название команды — только для командной доски, для подписи "Командная доска · Team" */
  teamName?: string | null;
  canManage: boolean;
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

const nodes = computed(() => toFlowNodes(props.items));
const edges = computed(() => toFlowEdges(props.edges));

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

const { viewport } = useVueFlow();
const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100));

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
</script>

<template>
  <div ref="root" class="board-canvas-root h-full w-full bg-[var(--ui-bg)]">
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :nodes-draggable="false"
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
      show-interactive скрыт: переключает драг/коннект узлов, которых пока нет (12.6+) -->
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
