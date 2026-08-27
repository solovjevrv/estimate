<script setup lang="ts">
/**
 * Контейнер-фрейм/группа (14.3). Один компонент обслуживает оба типа:
 * `content.type === 'frame'` — видимая рамка с заголовком НАД собой, как в Miro
 *   (не внутри — заголовок не должен перекрывать содержимое мини-холста);
 * `content.type === 'group'`   — невидимый контейнер (без заливки/рамки/заголовка),
 *   создаётся действием «Группировать» на выделении.
 *
 * Дочерние элементы движутся вместе с контейнером благодаря
 * `extent: 'parent'`/`parentNode` в `vue-flow-adapter.ts` — нам не нужно
 * ничего делать с координатами детей вручную. Мы лишь рендерим хром (для
 * frame) и обеспечиваем возможность ресайза.
 *
 * Ресайз фрейма пишет в `node.style.width/height` (как у стикера, 12.7-баг),
 * поэтому зеркалируем тот же патчинг `style.width/height` из `boardItemToNode`:
 * NodeResizer сам не знает о нашем абстрактном `item.width/height`.
 *
 * Размер/цвет текста заголовка (22.4.1) — те же generic-поля `BoardItemStyle`,
 * что у остальных типов, тулбар выделения (`BoardSelectionToolbar.vue`) для
 * фрейма показывает усечённый набор («Aa», без режима auto/выравнивания/
 * начертания — заголовок это одна строка без rich-text). Шаблоны размера/
 * пропорций фрейма (22.4.2, `FRAME_SIZE_PRESETS`) патчат `width`/`height`
 * напрямую из тулбара — сюда попадают тем же путём, что и обычный ресайз.
 */
import { BOARD_FRAME_TITLE_MAX_LENGTH, type BoardItem } from '@poker/shared';
import {
  NodeResizer,
  type OnResize,
  type OnResizeEnd,
  type OnResizeStart,
} from '@vue-flow/node-resizer';
import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  BOARD_CAN_EDIT_KEY,
  BOARD_RESIZE_SNAP_KEY,
} from '../../features/boards/context/board-canvas-keys';
import { FIT_FONT_MAX } from '../../features/boards/composables/use-fit-font-size';
import { darkenHex, readableTextColor } from '../../features/boards/domain/board-colors';
import {
  FRAME_MAX_HEIGHT,
  FRAME_MAX_WIDTH,
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
} from '../../features/boards/config/board-constants';
import { resizeAxisFlags, resizeRectFromOrigin } from '../../features/boards/domain/board-snap';
import { uuid } from '../../features/boards/infrastructure/uuid';
import { useBoardSessionStore } from '../../stores/board-session';
import type { NodeProps } from '@vue-flow/core';

const props = defineProps<NodeProps<BoardItem>>();

const { t } = useI18n();
const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const resizeSnap = inject(BOARD_RESIZE_SNAP_KEY, null);

const content = computed(() => props.data.content);
const isGroup = computed(() => content.value.type === 'group');
const frameTitle = computed(() => (content.value.type === 'frame' ? content.value.title : ''));

/**
 * Мягкая блокировка заголовка (14.2 — по образцу `use-rich-text-editing.ts`,
 * упрощённая версия под plain-инпут: у заголовка фрейма нет rich-text/runs,
 * так что полный composable избыточен). Своя же блокировка (`participantId`
 * совпадает с текущим участником) в `lockedBy` не попадает — чтобы
 * можно было снять фокус и зайти снова, не блокируя самого себя.
 */
const selfParticipantId = computed(() => boardSession.participantId);
const lockedBy = computed(() => {
  const lock = boardSession.editingByItem.get(props.id);
  return lock && lock.participantId !== selfParticipantId.value ? lock : null;
});

/**
 * Цвет рамки фрейма — заметно тёмнее заливки (как у стикера, board-colors.ts),
 * чтобы контур был читаем на любой заливке. Для группы — transparent (видима
 * только рамка выделения Vue Flow, как в Figma).
 */
const strokeColor = computed(() => darkenHex(props.data.style.color, 0.25));

/**
 * Заливка фона фрейма — лёгкий (14%) тон выбранного `style.color`, не сплошная
 * заливка: фрейм не должен визуально "съедать" контраст содержимого внутри
 * него. Меняется через тот же цветовой свотч тулбара выделения (14.3), что и
 * у стикера/фигуры — `setSelectedColor` в BoardCanvas.vue общий для всех типов.
 */
const fillColor = computed(() => `color-mix(in oklch, ${props.data.style.color} 14%, transparent)`);

/**
 * Размер/цвет текста заголовка (22.4.1) — те же generic-поля `BoardItemStyle`,
 * что и у остальных типов (стикер/фигура/текст), просто без режима «Авто»
 * (масштабирование шрифта с боксом здесь неприменимо — заголовок не занимает
 * весь бокс фрейма, это отдельная строка НАД ним, см. шапку файла) — тулбар
 * (`BoardSelectionToolbar.vue`) для фрейма скрывает переключатель режима и
 * всегда пишет фиксированное число. `FIT_FONT_MAX` — тот же фоллбэк, что
 * `selectedBaseFontSize` в `use-board-selection.ts` показывает в тулбаре при
 * незаданном style.fontSize — иначе тулбар и рендер разошлись бы в цифрах.
 */
const titleFontSize = computed(() => props.data.style.fontSize ?? FIT_FONT_MAX);
const titleColor = computed(
  () => props.data.style.textColor ?? readableTextColor(props.data.style.color),
);
/** Смещение плашки заголовка вверх от рамки фрейма — зависит от выбранного
 * размера шрифта (22.4.1): фиксированный отступ (было -28px под шрифт ~14px)
 * при увеличении шрифта наезжал бы на рамку фрейма. */
const titleBarTop = computed(() => `${-(titleFontSize.value * 1.2 + 14)}px`);

/** Локальный черновик заголовка — синхронизируем с prop при смене */
const titleDraft = ref('');
watch(
  () => frameTitle.value,
  (next) => {
    titleDraft.value = next;
  },
  { immediate: true },
);

function onTitleFocus(): void {
  if (!canEdit.value) return;
  void boardSession.sendAwareness('editing', { itemId: props.id, active: true });
}

function commitTitle(): void {
  if (canEdit.value) {
    void boardSession.sendAwareness('editing', { itemId: props.id, active: false });
  }
  if (titleDraft.value === frameTitle.value) return;
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: uuid(),
      id: props.id,
      patch: { content: { type: 'frame', title: titleDraft.value } },
    },
  ]);
}

/** Координаты резайзера на момент `resizeStart` — точка отсчёта для
 * `resizeAxisFlags` (см. `use-board-node-editing.ts`/`board-snap.ts`). */
let resizeStart = { x: 0, y: 0 };

function onResizeStart({ params: { x, y } }: OnResizeStart): void {
  resizeStart = { x, y };
}

/** Геометрия ДО жеста — заведомо абсолютная (`BoardItem.x/y`), в отличие от
 * `params.x/y` резайзера (см. `resizeRectFromOrigin`). У фрейма `parentId`
 * всегда null, поэтому этот баг здесь не проявлялся, но проще держать один
 * и тот же путь построения rect'а, а не полагаться на этот инвариант. */
function originRect() {
  return {
    id: props.id,
    x: props.data.x,
    y: props.data.y,
    width: props.data.width,
    height: props.data.height,
  };
}

function onResize({ params: { x, y, width, height } }: OnResize): void {
  const origin = originRect();
  const flags = resizeAxisFlags(resizeStart.x, resizeStart.y, origin, x, y, width, height);
  const rect = resizeRectFromOrigin(origin, width, height, flags);
  resizeSnap?.updateGuides(props.id, rect, flags, false);
}

function onResizeEnd({ params: { x, y, width, height } }: OnResizeEnd): void {
  const origin = originRect();
  const flags = resizeAxisFlags(resizeStart.x, resizeStart.y, origin, x, y, width, height);
  const rect = resizeRectFromOrigin(origin, width, height, flags);
  const snapped = resizeSnap?.applySnap(props.id, rect, flags, false) ?? rect;
  resizeSnap?.clearGuides();
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: uuid(),
      id: props.id,
      patch: snapped,
    },
  ]);
}
</script>

<template>
  <div
    class="board-frame-node relative h-full w-full"
    :class="{ 'board-frame-node--group': isGroup }"
    :data-testid="isGroup ? 'board-node-group' : 'board-node-frame'"
    :data-node-id="props.id"
    :data-selected="props.selected ? 'true' : 'false'"
  >
    <!--
      NodeResizer — только для видимых фреймов (группы — невидимы, но
      ресайзим их по-прежнему, чтобы дети пересчитались). `keep-aspect-ratio`
      НЕ задаём: пользователь сам задаёт пропорцию.
    -->
    <NodeResizer
      v-if="canEdit"
      :is-visible="props.selected"
      :min-width="FRAME_MIN_WIDTH"
      :min-height="FRAME_MIN_HEIGHT"
      :max-width="FRAME_MAX_WIDTH"
      :max-height="FRAME_MAX_HEIGHT"
      @resize-start="onResizeStart"
      @resize="onResize"
      @resize-end="onResizeEnd"
    />
    <div
      v-if="!isGroup"
      class="board-frame-border absolute inset-0 rounded-xl"
      :style="{ borderColor: strokeColor, backgroundColor: fillColor }"
      @dblclick.stop
    />
    <!-- Заголовок — НАД фреймом, не внутри (как в Miro): фрейм это мини-холст,
         заголовок не должен перекрывать содержимое -->
    <div
      v-if="!isGroup && (canEdit || frameTitle)"
      class="board-frame-title-bar nodrag"
      :style="{ top: titleBarTop }"
    >
      <input
        v-if="canEdit"
        v-model="titleDraft"
        class="board-frame-title"
        :style="{ color: titleColor, fontSize: `${titleFontSize}px` }"
        :maxlength="BOARD_FRAME_TITLE_MAX_LENGTH"
        :disabled="!!lockedBy"
        :placeholder="t('board.frameTitlePlaceholder')"
        @focus="onTitleFocus"
        @blur="commitTitle"
      />
      <span
        v-else
        class="board-frame-title board-frame-title-readonly"
        :style="{ color: titleColor, fontSize: `${titleFontSize}px` }"
        >{{ frameTitle }}</span
      >
      <span v-if="lockedBy" class="board-frame-title-lock">
        {{ t('board.editingBy', { name: lockedBy.name }) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.board-frame-node--group :deep(.vue-flow__resizer) {
  /* Группа невидима, но хендлы ресайзера — видны (иначе нельзя изменить размер) */
  border-color: var(--ui-primary);
}
.board-frame-border {
  border-width: 2px;
  border-style: dashed;
  /* Фактическая заливка — инлайн `backgroundColor` (fillColor computed) от
     style.color конкретного фрейма; здесь только дефолт-фоллбэк */
  background: color-mix(in oklch, var(--ui-primary) 4%, transparent);
}
/* Заголовок — над рамкой фрейма (отрицательный top), не внутри неё (Miro).
   `top` — инлайн (`titleBarTop`, 22.4.1): зависит от выбранного размера
   шрифта заголовка, статичное число здесь — фоллбэк на случай отсутствия
   инлайн-стиля (не должен фактически применяться). */
.board-frame-title-bar {
  position: absolute;
  top: -28px;
  left: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.board-frame-title {
  min-width: 0;
  overflow: hidden;
  /* Фоллбэк — фактический цвет/размер приходят инлайн (`titleColor`/
     `titleFontSize`, 22.4.1), те же generic-поля стиля, что у остальных типов. */
  color: var(--brand-ink);
  white-space: nowrap;
  text-overflow: ellipsis;
  background: transparent;
  border: none;
  outline: none;
  font-weight: 600;
  resize: none;
}
.board-frame-title:disabled {
  cursor: default;
  opacity: 0.6;
}
.board-frame-title-readonly {
  flex: 1;
  cursor: default;
}
.board-frame-title-lock {
  flex-shrink: 0;
  padding: 2px 6px;
  color: var(--brand-ink2);
  white-space: nowrap;
  background: var(--brand-surface);
  border-radius: 10px;
  box-shadow: var(--brand-shadow-card);
  font-size: 10px;
  font-weight: 600;
}
</style>
