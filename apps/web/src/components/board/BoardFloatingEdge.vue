<script setup lang="ts">
import { BOARD_EDGE_LABEL_MAX_LENGTH, type BoardEdge } from '@poker/shared';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  Position,
  useVueFlow,
  type EdgeProps,
} from '@vue-flow/core';
import { computed, inject, nextTick, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  BOARD_CAN_EDIT_KEY,
  BOARD_PENDING_EDGE_EDIT_ID_KEY,
} from '../../features/boards/context/board-canvas-keys';
import { resolveEdgeColor } from '../../features/boards/config/board-item-defaults';
import {
  clampLabelOffset,
  type EdgeAnchorSide,
  getEdgeAnchorParams,
  getOffsetCurvePath,
} from '../../features/boards/domain/floating-edge-geometry';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<EdgeProps<BoardEdge>>();

const { t } = useI18n();
const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const pendingEdgeEditId = inject(BOARD_PENDING_EDGE_EDIT_ID_KEY, ref(null));
const { project, vueFlowRef } = useVueFlow();

/** Не задан в data.style.color (12.9) — точка 'dot' красится так же, как линия/маркер */
const dotColor = computed(() => resolveEdgeColor(props.data.style.color));

/**
 * Перевод нашей неймпрового `EdgeAnchorSide` в `Position` Vue Flow — единственная
 * точка, где рендерер-layer знает о типах Vue Flow. Внешний SVG-результат отличается
 * только именованием полей в `EdgeAnchorParams` (sourceSide/targetSide вместо
 * Position), сами пути строятся теми же вызовами `getSmoothStepPath`/`getBezierPath`.
 */
function toVueFlowPosition(side: EdgeAnchorSide): Position {
  switch (side) {
    case 'top':
      return Position.Top;
    case 'bottom':
      return Position.Bottom;
    case 'left':
      return Position.Left;
    case 'right':
      return Position.Right;
  }
}

const params = computed(() =>
  getEdgeAnchorParams(
    props.sourceNode,
    props.targetNode,
    props.data.sourceHandle,
    props.data.targetHandle,
  ),
);

const straightMid = computed(() => ({
  x: (params.value.sx + params.value.tx) / 2,
  y: (params.value.sy + params.value.ty) / 2,
}));

const dragOffsetPreview = ref<{ x: number; y: number } | null>(null);

const pathData = computed(() => {
  const { sx, sy, tx, ty, sourceSide, targetSide } = params.value;
  const line = props.data.style.line;

  if (line === 'orthogonal') {
    return getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: toVueFlowPosition(sourceSide),
      targetX: tx,
      targetY: ty,
      targetPosition: toVueFlowPosition(targetSide),
      borderRadius: 8,
    });
  }
  if (line === 'curved') {
    const activeOffset = dragOffsetPreview.value ?? props.data.style.curveOffset ?? null;
    if (activeOffset) {
      return getOffsetCurvePath(sx, sy, tx, ty, activeOffset);
    }
    return getBezierPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: toVueFlowPosition(sourceSide),
      targetX: tx,
      targetY: ty,
      targetPosition: toVueFlowPosition(targetSide),
    });
  }
  return getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });
});

const path = computed(() => pathData.value[0]);
const labelX = computed(() => pathData.value[1]);
const labelY = computed(() => pathData.value[2]);

const curveHandlePosition = computed(() => {
  if (dragOffsetPreview.value) {
    return {
      x: straightMid.value.x + dragOffsetPreview.value.x,
      y: straightMid.value.y + dragOffsetPreview.value.y,
    };
  }
  const stored = props.data.style.curveOffset;
  if (stored) {
    return { x: straightMid.value.x + stored.x, y: straightMid.value.y + stored.y };
  }
  return { x: labelX.value, y: labelY.value };
});

/**
 * Подпись пишется прямо на стрелке (Miro-паттерн, решение пользователя
 * 07.08.2026), без отдельного поля в тулбаре и без белой подложки — просто
 * текст поверх холста. Вход в редактирование — либо двойной клик по самой
 * линии (ловится на уровне `<VueFlow>` через `@edge-double-click`, т.к.
 * HTML-оверлей подписи, когда её ещё нет, не перекрывает SVG-путь), либо
 * двойной клик по уже существующей подписи (ловится локально ниже — сам
 * оверлей перекрывает путь под собой), либо кнопка «текст» в
 * `BoardEdgeToolbar.vue`. Оба внешних входа проходят через общий
 * `pendingEdgeEditId`, тот же приём, что `pendingEditId` у стикеров/фигур.
 *
 * Для пустой связи сразу подставляется и выделяется слово-заглушка (как в
 * Miro) — видно, что сюда можно печатать, и первый же символ перезаписывает
 * её целиком. Если уйти не напечатав ничего, заглушка не сохраняется.
 */
const EDGE_LABEL_MAX_WIDTH_CH = 28;

const editing = ref(false);
const draftText = ref('');
const inputEl = useTemplateRef<HTMLTextAreaElement>('labelInput');

function placeholderWord(): string {
  return t('board.edgeLabelPlaceholder');
}

async function startEditing(): Promise<void> {
  if (editing.value || !canEdit.value) return;
  draftText.value = props.data.label ?? placeholderWord();
  editing.value = true;
  await nextTick();
  resizeLabelInput();
  inputEl.value?.focus();
  inputEl.value?.select();
}

watch(pendingEdgeEditId, (id) => {
  if (id !== props.id) return;
  pendingEdgeEditId.value = null;
  void startEditing();
});

function commitEditing(): void {
  if (!editing.value) return;
  editing.value = false;
  const wasEmpty = !props.data.label;
  const rawText = draftText.value.trim();
  const text = wasEmpty && rawText === placeholderWord() ? '' : rawText;
  const label = text ? text.slice(0, BOARD_EDGE_LABEL_MAX_LENGTH) : null;
  if (label === (props.data.label ?? null)) return;
  void boardSession.applyOps([
    {
      type: 'edge.patch',
      clientOpId: globalThis.crypto.randomUUID(),
      id: props.id,
      patch: { label },
    },
  ]);
}

function cancelEditing(): void {
  editing.value = false;
}

/**
 * Авторазмер textarea (аналог `field-sizing` без Safari-проблем): ширина — по
 * самой длинной строке `draftText.split('\n')` в диапазоне `2..EDGE_LABEL_MAX_WIDTH_CH`
 * ch, высота — по `scrollHeight`, чтобы расти по числу строк без вертикального скролла.
 * Длинные слова переносятся CSS (`overflow-wrap: anywhere`), а ширина жёстко ограничена
 * 28ch, поэтому подпись не выходит за пределы даже без пробелов.
 */
const labelInputStyle = computed(() => {
  const longest = draftText.value.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
  const cols = Math.min(EDGE_LABEL_MAX_WIDTH_CH, Math.max(2, longest + 1));
  return { width: `${cols}ch` } as const;
});

/** Обнуляем inline-height: иначе `scrollHeight` отражает прежний (больший) размер,
 *  и textarea не схлопнется при удалении строк — классический трюк для автороста. */
function resizeLabelInput(): void {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = '0';
  el.style.height = `${el.scrollHeight}px`;
}

watch(draftText, async () => {
  await nextTick();
  resizeLabelInput();
});

/**
 * Любой keydown внутри textarea останавливает всплытие в Vue Flow / глобальные
 * hotkeys (`.stop`). Обычный Enter НЕ prevent-им — он вставляет `\n` и не завершает
 * редактирование; Ctrl+Enter / Cmd+Enter завершают через blur → commitEditing.
 */
function onLabelKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelEditing();
    return;
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    inputEl.value?.blur();
  }
}

/**
 * Ручка изгиба связи (12.17) — перетаскивание локального смещения апекса
 * кривой. Коммит одним edge.patch на pointerup, как NodeResizer/@resize-end.
 */
const CURVE_OFFSET_RESET_EPSILON = 4;
const LABEL_OFFSET_RESET_EPSILON = 4; // px, как у CURVE_OFFSET_RESET_EPSILON
const LABEL_DRAG_THRESHOLD = 3; // px — ниже порога это клик/dblclick, не драг
/** Miro-подобное ограничение (12.18): вдоль линии — почти свободно, поперёк — только небольшой отступ */
const LABEL_PERPENDICULAR_MAX = 32;

const dragLabelOffsetPreview = ref<{ x: number; y: number } | null>(null);

/**
 * Позиция подписи = базовая точка (labelX/labelY) + активное смещение:
 * либо превью текущего драга, либо сохранённый labelOffset, либо null
 * (подпись ровно в базовой точке, как до фичи 12.18). Смещение ОТНОСИТЕЛЬНОЕ:
 * при движении концов связи базовая точка меняется, а подпись едет вместе с ней.
 */
const labelPosition = computed(() => {
  const base = { x: labelX.value, y: labelY.value };
  const active = dragLabelOffsetPreview.value ?? props.data.style.labelOffset ?? null;
  if (!active) return base;
  return { x: base.x + active.x, y: base.y + active.y };
});

function toWorldPoint(event: PointerEvent): { x: number; y: number } {
  const rect = vueFlowRef.value?.getBoundingClientRect();
  if (!rect) return straightMid.value;
  return project({ x: event.clientX - rect.left, y: event.clientY - rect.top });
}

function onCurveHandlePointerDown(event: PointerEvent): void {
  if (!canEdit.value) return;
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
  const start = toWorldPoint(event);
  dragOffsetPreview.value = {
    x: start.x - straightMid.value.x,
    y: start.y - straightMid.value.y,
  };
  window.addEventListener('keydown', onCurveDragKeydown);
}

function onCurveHandlePointerMove(event: PointerEvent): void {
  if (!dragOffsetPreview.value) return;
  const point = toWorldPoint(event);
  dragOffsetPreview.value = {
    x: point.x - straightMid.value.x,
    y: point.y - straightMid.value.y,
  };
}

function onCurveHandlePointerUp(): void {
  if (!dragOffsetPreview.value) return;
  const offset = dragOffsetPreview.value;
  dragOffsetPreview.value = null;
  window.removeEventListener('keydown', onCurveDragKeydown);
  const magnitude = Math.hypot(offset.x, offset.y);
  commitCurveOffset(magnitude < CURVE_OFFSET_RESET_EPSILON ? null : offset);
}

function onCurveDragKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  dragOffsetPreview.value = null;
  window.removeEventListener('keydown', onCurveDragKeydown);
}

function resetCurveOffset(): void {
  if (!canEdit.value) return;
  commitCurveOffset(null);
}

/**
 * Драг прерывается без pointerup, если компонент размонтируется раньше
 * (другой участник удалил связь, undo/redo, виртуализация Vue Flow при
 * скролле) — браузер сам снимает pointer capture с удалённого узла, поэтому
 * наш pointerup никогда не придёт. Без этого слушатель Escape навсегда
 * оставался бы висеть на window.
 */
onUnmounted(() => {
  window.removeEventListener('keydown', onCurveDragKeydown);
  window.removeEventListener('keydown', onLabelDragKeydown);
});

function commitCurveOffset(offset: { x: number; y: number } | null): void {
  if (offset === (props.data.style.curveOffset ?? null)) return;
  void boardSession.applyOps([
    {
      type: 'edge.patch',
      clientOpId: globalThis.crypto.randomUUID(),
      id: props.id,
      patch: { style: { ...props.data.style, curveOffset: offset } },
    },
  ]);
}

/**
 * Перетаскивание подписи связи (12.18) — сама подпись является «хватом»,
 * нет отдельной ручки. Коммит одним edge.patch на pointerup (labelOffset),
 * без нового WS-события — переиспользуем boardSession.applyOps.
 */
const labelDragStart = ref<{ x: number; y: number } | null>(null);
const labelDragBaseOffset = ref<{ x: number; y: number }>({ x: 0, y: 0 });

function onLabelPointerDown(event: PointerEvent): void {
  if (!canEdit.value || editing.value) return;
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
  labelDragStart.value = toWorldPoint(event);
  labelDragBaseOffset.value = props.data.style.labelOffset ?? { x: 0, y: 0 };
  window.addEventListener('keydown', onLabelDragKeydown);
}

function onLabelPointerMove(event: PointerEvent): void {
  if (!labelDragStart.value) return;
  const point = toWorldPoint(event);
  const dx = point.x - labelDragStart.value.x;
  const dy = point.y - labelDragStart.value.y;
  if (!dragLabelOffsetPreview.value && Math.hypot(dx, dy) < LABEL_DRAG_THRESHOLD) return;
  const raw = {
    x: labelDragBaseOffset.value.x + dx,
    y: labelDragBaseOffset.value.y + dy,
  };
  const { sx, sy, tx, ty } = params.value;
  dragLabelOffsetPreview.value = clampLabelOffset(sx, sy, tx, ty, raw, LABEL_PERPENDICULAR_MAX);
}

function onLabelPointerUp(): void {
  labelDragStart.value = null;
  window.removeEventListener('keydown', onLabelDragKeydown);
  if (!dragLabelOffsetPreview.value) return; // не было реального драга — обычный клик
  const offset = dragLabelOffsetPreview.value;
  dragLabelOffsetPreview.value = null;
  const magnitude = Math.hypot(offset.x, offset.y);
  commitLabelOffset(magnitude < LABEL_OFFSET_RESET_EPSILON ? null : offset);
}

function onLabelDragKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  labelDragStart.value = null;
  dragLabelOffsetPreview.value = null;
  window.removeEventListener('keydown', onLabelDragKeydown);
}

function commitLabelOffset(offset: { x: number; y: number } | null): void {
  if (offset === (props.data.style.labelOffset ?? null)) return;
  void boardSession.applyOps([
    {
      type: 'edge.patch',
      clientOpId: globalThis.crypto.randomUUID(),
      id: props.id,
      patch: { style: { ...props.data.style, labelOffset: offset } },
    },
  ]);
}
</script>

<template>
  <!-- BaseEdge не пробрасывает произвольные attrs в SVG path; testid ставим на
       реальный SVG-контейнер, не меняя геометрию или bubbling событий Vue Flow. -->
  <g data-testid="board-edge">
    <BaseEdge
      :id="id"
      :path="path"
      :marker-start="markerStart"
      :marker-end="markerEnd"
      :style="style"
    />
    <!-- 'dot' — не встроенный тип маркера Vue Flow (умеет рисовать только arrow/arrowclosed),
         рисуем сами поверх пути -->
    <circle
      v-if="data.style.markerStart === 'dot'"
      :cx="params.sx"
      :cy="params.sy"
      r="4"
      :fill="dotColor"
    />
    <circle
      v-if="data.style.markerEnd === 'dot'"
      :cx="params.tx"
      :cy="params.ty"
      r="4"
      :fill="dotColor"
    />
    <circle
      v-if="canEdit && data.style.line === 'curved' && selected"
      data-testid="board-edge-curve-handle"
      class="board-edge-curve-handle nodrag nopan"
      :cx="curveHandlePosition.x"
      :cy="curveHandlePosition.y"
      r="5"
      @pointerdown.stop="onCurveHandlePointerDown"
      @pointermove.stop="onCurveHandlePointerMove"
      @pointerup.stop="onCurveHandlePointerUp"
      @dblclick.stop="resetCurveOffset"
    />
  </g>

  <EdgeLabelRenderer>
    <div
      v-if="editing || data.label"
      data-testid="board-edge-label"
      class="board-edge-label nodrag nopan"
      :class="{ 'board-edge-label--draggable': canEdit && !editing }"
      :style="{
        transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
      }"
      @dblclick.stop="startEditing"
      @pointerdown.stop="onLabelPointerDown"
      @pointermove.stop="onLabelPointerMove"
      @pointerup.stop="onLabelPointerUp"
    >
      <textarea
        v-if="editing"
        ref="labelInput"
        v-model="draftText"
        :maxlength="BOARD_EDGE_LABEL_MAX_LENGTH"
        rows="1"
        spellcheck="false"
        data-testid="board-edge-label-input"
        class="board-edge-label-input"
        :style="labelInputStyle"
        @keydown.stop="onLabelKeydown"
        @blur="commitEditing"
      />
      <span v-else data-testid="board-edge-label-text" class="board-edge-label-text">{{
        data.label
      }}</span>
    </div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.board-edge-label {
  position: absolute;
  pointer-events: all;
}

.board-edge-curve-handle {
  fill: var(--ui-color-primary-500);
  stroke: var(--brand-surface, #fff);
  stroke-width: 1.5px;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.12s ease;
  /* .vue-flow__edge (обёртка Vue Flow вокруг этого компонента) задаёт
     pointer-events: visibleStroke — попадание указателя только по контуру,
     не по заливке. Без явного override клик/драг по видимому кружку не
     долетает вообще (та же ловушка, что уже обошли для .board-edge-label). */
  pointer-events: all;
}
.board-edge-curve-handle:hover,
g:hover .board-edge-curve-handle {
  opacity: 1;
}

/* Полупрозрачная подложка под текстом (12.18) — гало из text-shadow плохо
   читалось на пёстром/тёмном фоне холста; var(--ui-bg) уже темизирована,
   color-mix даёт лёгкую прозрачность вместо сплошного прямоугольника */
.board-edge-label-text,
.board-edge-label-input {
  color: var(--brand-ink);
  background: color-mix(in oklch, var(--ui-bg) 82%, transparent);
  border-radius: 4px;
  padding: 1px 4px;
}

.board-edge-label--draggable {
  cursor: grab;
}
.board-edge-label--draggable:active {
  cursor: grabbing;
}

.board-edge-label-text {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  /* 28ch — жёсткий лимит ширины подписи, согласован с EDGE_LABEL_MAX_WIDTH_CH */
  max-inline-size: 28ch;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: text;
}

.board-edge-label-input {
  display: block;
  box-sizing: border-box;
  /* min-height ровно на одну строку — line-height × font-size */
  min-height: 1.4em;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  text-align: center;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  resize: none;
  overflow: hidden;
  border: none;
  outline: none;
}
</style>
