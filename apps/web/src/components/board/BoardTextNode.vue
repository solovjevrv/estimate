<script setup lang="ts">
import {
  BOARD_ITEM_FONT_SIZE_MAX,
  BOARD_ITEM_FONT_SIZE_MIN,
  type BoardItem,
  type BoardTextContent,
} from '@estimate/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import {
  NodeResizer,
  type OnResize,
  type OnResizeEnd,
  type OnResizeStart,
} from '@vue-flow/node-resizer';
import { computed, inject, onBeforeUnmount, ref, toRef, useTemplateRef, watch } from 'vue';

import {
  BOARD_CAN_EDIT_KEY,
  BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY,
  BOARD_RESIZE_SNAP_KEY,
} from '../../features/boards/context/board-canvas-keys';
import { readableTextColor } from '../../features/boards/domain/board-colors';
import {
  boardFontFamilyCss,
  TEXT_MAX_HEIGHT,
  TEXT_MAX_WIDTH,
  TEXT_MIN_HEIGHT,
  TEXT_MIN_WIDTH,
} from '../../features/boards/config/board-item-defaults';
import { resizeAxisFlags, resizeRectFromOrigin } from '../../features/boards/domain/board-snap';
import {
  FIT_FONT_MAX,
  getScaledFontSize,
  useFitFontSize,
} from '../../features/boards/composables/use-fit-font-size';
import { useRichTextEditing } from '../../features/boards/composables/use-rich-text-editing';
import { useBoardSessionStore } from '../../stores/board-session';
import BoardEditingBadge from './shared/BoardEditingBadge.vue';
import BoardRichText from './BoardRichText.vue';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const effectiveFontSizes = inject(BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY, null);
const resizeSnap = inject(BOARD_RESIZE_SNAP_KEY, null);

const content = computed(() => props.data.content as BoardTextContent);
const textColor = computed(
  () => props.data.style.textColor ?? readableTextColor(props.data.style.color),
);
const fontFamily = computed(() => boardFontFamilyCss(props.data.style.fontFamily));
const textAlign = computed(() => props.data.style.textAlign ?? 'left');
const baseFontSize = computed(() => props.data.style.fontSize ?? FIT_FONT_MAX);
const fontSizeMode = computed(() => props.data.style.fontSizeMode ?? 'auto');

const contentBoxEl = useTemplateRef<HTMLDivElement>('contentBox');
const textEl = useTemplateRef<HTMLSpanElement>('text');

const {
  displayRuns,
  editing,
  lockedBy,
  liveText,
  formatTick,
  editableEl,
  startEditing,
  cancelEditing,
  refreshActiveMarks,
  onEditableBlur,
  onEditableInput,
  onEditableKeydownEnter,
  onEditableBeforeInput,
  onEditableCompositionStart,
  onEditableCompositionEnd,
  onEditablePaste,
  onEditableDrop,
} = useRichTextEditing({
  itemId: props.id,
  canEdit,
  isSelected: toRef(props, 'selected'),
  content,
  buildContent: (text, runs) => ({ type: 'text', text, ...(runs ? { runs } : {}) }),
});

/**
 * Размер шрифта подбирается под фиксированный бокс карточки (не бокс растёт
 * под текст) — см. `use-fit-font-size.ts`. Один и тот же расчёт для обоих
 * режимов (просмотр/редактирование), чтобы шрифт не «прыгал» при входе в
 * редактирование. `manageHeight: true` — у contenteditable, как и у textarea
 * раньше, нет авторазмера по контенту, высотой в режиме редактирования
 * управляем сами.
 */
const fitText = computed(() => {
  // Формат (жирный/зачёркнутый) меняет ширину текста без изменения его длины —
  // `liveText` в этот момент не поменялась бы сама по себе, поэтому дополнительно
  // зависим от `formatTick`, чтобы авто-fit пересчитался и после клика по тулбару
  void formatTick.value;
  return editing.value ? liveText.value : content.value.text;
});
const boxWidth = computed(() => props.data.width);
const boxHeight = computed(() => props.data.height);
const measureEl = computed(() => (editing.value ? editableEl.value : textEl.value));
const fontSize = useFitFontSize(
  contentBoxEl,
  measureEl,
  fitText,
  boxWidth,
  boxHeight,
  editing,
  baseFontSize,
  fontSizeMode,
);

let reportedItemId: string | null = null;
watch(
  [() => props.id, fontSize],
  ([itemId, size]) => {
    if (!effectiveFontSizes) return;
    if (reportedItemId && reportedItemId !== itemId) effectiveFontSizes.remove(reportedItemId);
    effectiveFontSizes.set(itemId, size);
    reportedItemId = itemId;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (reportedItemId) effectiveFontSizes?.remove(reportedItemId);
});

/** Координаты резайзера на момент `resizeStart` — точка отсчёта для
 * `resizeAxisFlags` (см. `use-board-node-editing.ts`/`board-snap.ts`). */
let resizeStart = { x: 0, y: 0 };

function onResizeStart({ params: { x, y } }: OnResizeStart): void {
  resizeStart = { x, y };
}

/** Геометрия ДО жеста — заведомо абсолютная (`BoardItem.x/y`), в отличие от
 * `params.x/y` резайзера (см. `resizeRectFromOrigin`). */
function originRect() {
  return {
    id: props.id,
    x: props.data.x,
    y: props.data.y,
    width: props.data.width,
    height: props.data.height,
  };
}

/** Live-подсказка выравнивания во время resize (22.3) — см. `use-board-node-editing.ts`. */
function onResize({ params: { x, y, width, height } }: OnResize): void {
  const origin = originRect();
  const flags = resizeAxisFlags(resizeStart.x, resizeStart.y, origin, x, y, width, height);
  const rect = resizeRectFromOrigin(origin, width, height, flags);
  resizeSnap?.updateGuides(props.id, rect, flags, false);
}

/**
 * В `auto` (26.08.2026, по референсу Miro) пересчитывает `style.fontSize`
 * пропорционально ИМЕННО ЭТОМУ resize (было — якорь `fontSizeBoxWidth/Height`,
 * а не всегда `props.data.width/height`, см. пояснение в `BoardItemStyle` — →
 * стало `width/height`) и сохраняет обе величины как новую базу/якорь — см.
 * подробное пояснение у аналогичного `onResizeEnd` в
 * `use-board-node-editing.ts` (BoardStickyNode/BoardShapeNode используют общий
 * composable, у текста своя копия, так как он не проходит через
 * `useBoardNodeEditing`). Снап к соседним элементам (22.3) применяется здесь
 * же, ДО пересчёта шрифта — см. тот же порядок в `use-board-node-editing.ts`.
 */
function onResizeEnd({ params: { x, y, width, height } }: OnResizeEnd): void {
  const origin = originRect();
  const flags = resizeAxisFlags(resizeStart.x, resizeStart.y, origin, x, y, width, height);
  const rect = resizeRectFromOrigin(origin, width, height, flags);
  const snapped = resizeSnap?.applySnap(props.id, rect, flags, false) ?? rect;
  resizeSnap?.clearGuides();
  const patch: {
    x: number;
    y: number;
    width: number;
    height: number;
    style?: { fontSize: number; fontSizeBoxWidth: number; fontSizeBoxHeight: number };
  } = { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height };
  if (fontSizeMode.value === 'auto') {
    const anchorWidth = props.data.style.fontSizeBoxWidth ?? props.data.width;
    const anchorHeight = props.data.style.fontSizeBoxHeight ?? props.data.height;
    const nextFontSize = Math.min(
      BOARD_ITEM_FONT_SIZE_MAX,
      Math.max(
        BOARD_ITEM_FONT_SIZE_MIN,
        getScaledFontSize(
          baseFontSize.value,
          snapped.width,
          snapped.height,
          anchorWidth,
          anchorHeight,
        ),
      ),
    );
    if (nextFontSize !== baseFontSize.value) {
      patch.style = {
        fontSize: nextFontSize,
        fontSizeBoxWidth: snapped.width,
        fontSizeBoxHeight: snapped.height,
      };
    }
  }
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: crypto.randomUUID(),
      id: props.id,
      patch,
    },
  ]);
}
</script>

<template>
  <div
    class="board-node-resizer-gap relative h-full w-full"
    data-testid="board-node-text"
    :data-node-id="props.id"
    :data-selected="props.selected ? 'true' : 'false'"
  >
    <BoardEditingBadge v-if="lockedBy" :name="lockedBy.name" data-testid="board-editing-badge" />
    <NodeResizer
      :is-visible="props.selected && !editing && canEdit && !lockedBy"
      :min-width="TEXT_MIN_WIDTH"
      :min-height="TEXT_MIN_HEIGHT"
      :max-width="TEXT_MAX_WIDTH"
      :max-height="TEXT_MAX_HEIGHT"
      @resize-start="onResizeStart"
      @resize="onResize"
      @resize-end="onResizeEnd"
    />
    <div
      ref="contentBox"
      data-testid="board-node-content"
      class="board-text-content flex h-full w-full items-center overflow-hidden p-4"
      :style="{ color: textColor }"
      @dblclick.stop="startEditing"
    >
      <template v-if="editing">
        <div
          ref="editable"
          class="nodrag h-full w-full cursor-text overflow-hidden bg-transparent whitespace-pre-wrap outline-none"
          contenteditable="true"
          :style="{
            color: textColor,
            fontSize: `${fontSize}px`,
            fontFamily,
            textAlign,
          }"
          @pointerdown.stop
          @keydown.esc.stop.prevent="cancelEditing"
          @keydown.enter.prevent="onEditableKeydownEnter"
          @beforeinput="onEditableBeforeInput"
          @compositionstart="onEditableCompositionStart"
          @compositionend="onEditableCompositionEnd"
          @input="onEditableInput"
          @paste="onEditablePaste"
          @drop="onEditableDrop"
          @mouseup="refreshActiveMarks"
          @keyup="refreshActiveMarks"
          @blur="onEditableBlur"
        />
      </template>
      <template v-else>
        <span
          ref="text"
          class="block w-full overflow-hidden break-words whitespace-pre-wrap"
          :style="{ fontSize: `${fontSize}px`, fontFamily, textAlign }"
        >
          <BoardRichText :runs="displayRuns" />
        </span>
      </template>
    </div>
    <!--
      Связи (12.8): по видимой точке на сторону, все type="source" +
      connection-mode="loose" + увеличенный connection-radius на VueFlow — так
      с любой из четырёх можно и начать, и принять связь, а Vue Flow сам
      подхватит ближайшую точку карточки, даже если отпустили курсор чуть
      мимо неё. Куда именно приклеен конец связи — решает не автогеометрия
      (первая версия так и делала — неудобно, точка "прыгала" при переносе
      карточек), а конкретный id хендла, который реально был схвачен/отпущен
      (см. floating-edge-geometry.ts) — то есть точка фиксированная и
      предсказуемая, просто следует за карточкой при её переносе.
    -->
    <template v-if="canEdit">
      <Handle
        id="top"
        type="source"
        :position="Position.Top"
        class="board-connect-handle"
        data-testid="board-handle"
      />
      <Handle
        id="right"
        type="source"
        :position="Position.Right"
        class="board-connect-handle"
        data-testid="board-handle"
      />
      <Handle
        id="bottom"
        type="source"
        :position="Position.Bottom"
        class="board-connect-handle"
        data-testid="board-handle"
      />
      <Handle
        id="left"
        type="source"
        :position="Position.Left"
        class="board-connect-handle"
        data-testid="board-handle"
      />
    </template>
  </div>
</template>

<style scoped>
@import './shared/board-node-resizer.css';
@import './shared/board-connect-handle.css';

/* Текстовый элемент — без фона/заливки/рамки, как в макете .design/main.html */
</style>
