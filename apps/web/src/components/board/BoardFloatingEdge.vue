<script setup lang="ts">
import { BOARD_EDGE_LABEL_MAX_LENGTH, type BoardEdge } from '@poker/shared';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  Position,
  type EdgeProps,
} from '@vue-flow/core';
import { computed, inject, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  BOARD_CAN_EDIT_KEY,
  BOARD_PENDING_EDGE_EDIT_ID_KEY,
} from '../../features/boards/context/board-canvas-keys';
import { resolveEdgeColor } from '../../features/boards/config/board-item-defaults';
import {
  type EdgeAnchorSide,
  getEdgeAnchorParams,
} from '../../features/boards/domain/floating-edge-geometry';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<EdgeProps<BoardEdge>>();

const { t } = useI18n();
const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const pendingEdgeEditId = inject(BOARD_PENDING_EDGE_EDIT_ID_KEY, ref(null));

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
  </g>

  <EdgeLabelRenderer>
    <div
      v-if="editing || data.label"
      data-testid="board-edge-label"
      class="board-edge-label nodrag nopan"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
      @dblclick.stop="startEditing"
      @pointerdown.stop
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

/* Никакой подложки (просьба пользователя) — просто текст поверх холста, с лёгким
   белым гало вместо белого прямоугольника, чтобы оставаться читаемым над линией */
.board-edge-label-text,
.board-edge-label-input {
  color: var(--brand-ink);
  text-shadow:
    -1px -1px 0 var(--ui-bg),
    1px -1px 0 var(--ui-bg),
    -1px 1px 0 var(--ui-bg),
    1px 1px 0 var(--ui-bg),
    0 0 6px var(--ui-bg);
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
  padding: 0;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  text-align: center;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  resize: none;
  overflow: hidden;
  background: transparent;
  border: none;
  outline: none;
}
</style>
