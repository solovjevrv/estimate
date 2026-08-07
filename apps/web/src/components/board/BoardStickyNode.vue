<script setup lang="ts">
import { BOARD_ITEM_TEXT_MAX_LENGTH, type BoardItem, type BoardStickyContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, nextTick, onMounted, ref, useTemplateRef } from 'vue';

import { BOARD_CAN_EDIT_KEY, BOARD_PENDING_EDIT_ID_KEY } from '../../lib/board/board-canvas-keys';
import { readableTextColor } from '../../lib/board/board-colors';
import {
  boardFontFamilyCss,
  STICKY_MAX_HEIGHT,
  STICKY_MAX_WIDTH,
  STICKY_MIN_HEIGHT,
  STICKY_MIN_WIDTH,
} from '../../lib/board/board-item-defaults';
import { FIT_FONT_MAX, useFitFontSize } from '../../lib/board/use-fit-font-size';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<NodeProps<BoardItem>>();

const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const pendingEditId = inject(BOARD_PENDING_EDIT_ID_KEY, ref(null));

const content = computed(() => props.data.content as BoardStickyContent);
const bgColor = computed(() => props.data.style.color);
const textColor = computed(() => props.data.style.textColor ?? readableTextColor(bgColor.value));
const fontFamily = computed(() => boardFontFamilyCss(props.data.style.fontFamily));
const textAlign = computed(() => props.data.style.textAlign ?? 'center');
const maxFontSize = computed(() => props.data.style.fontSize ?? FIT_FONT_MAX);

const editing = ref(false);
const draftText = ref('');
const contentBoxEl = useTemplateRef<HTMLDivElement>('contentBox');
const textareaEl = useTemplateRef<HTMLTextAreaElement>('textarea');
const textEl = useTemplateRef<HTMLSpanElement>('text');

/**
 * Размер шрифта подбирается под фиксированный бокс карточки (не бокс растёт
 * под текст) — см. `use-fit-font-size.ts`. Один и тот же расчёт для обоих
 * режимов (просмотр/редактирование), чтобы шрифт не «прыгал» при входе в
 * редактирование. `manageHeight: true` — у textarea, в отличие от span, нет
 * авторазмера по контенту, высотой в режиме редактирования управляем сами.
 */
const fitText = computed(() => (editing.value ? draftText.value : content.value.text));
const boxWidth = computed(() => props.data.width);
const boxHeight = computed(() => props.data.height);
const measureEl = computed(() => (editing.value ? textareaEl.value : textEl.value));
const fontSize = useFitFontSize(
  contentBoxEl,
  measureEl,
  fitText,
  boxWidth,
  boxHeight,
  editing,
  maxFontSize,
);

async function startEditing(): Promise<void> {
  if (editing.value || !canEdit.value) return;
  draftText.value = content.value.text;
  editing.value = true;
  await nextTick();
  textareaEl.value?.focus();
  textareaEl.value?.select();
}

// Только что созданный этим же клиентом стикер сразу входит в редактирование —
// иначе первое, что видит пользователь после создания, это пустая карточка
onMounted(() => {
  if (pendingEditId.value === props.id) {
    pendingEditId.value = null;
    void startEditing();
  }
});

function commitEditing(): void {
  if (!editing.value) return;
  editing.value = false;
  const text = draftText.value.slice(0, BOARD_ITEM_TEXT_MAX_LENGTH);
  if (text === content.value.text) return;
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: crypto.randomUUID(),
      id: props.id,
      patch: { content: { type: 'sticky', text } },
    },
  ]);
}

function cancelEditing(): void {
  editing.value = false;
}

function onResizeEnd({ params: { x, y, width, height } }: OnResizeEnd): void {
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: crypto.randomUUID(),
      id: props.id,
      patch: { x, y, width, height },
    },
  ]);
}
</script>

<template>
  <div class="relative h-full w-full">
    <NodeResizer
      :is-visible="props.selected && !editing && canEdit"
      :min-width="STICKY_MIN_WIDTH"
      :min-height="STICKY_MIN_HEIGHT"
      :max-width="STICKY_MAX_WIDTH"
      :max-height="STICKY_MAX_HEIGHT"
      keep-aspect-ratio
      color="var(--ui-primary)"
      @resize-end="onResizeEnd"
    />
    <div
      ref="contentBox"
      class="board-sticky-content flex h-full w-full items-center justify-center overflow-hidden rounded-md p-4 text-center font-semibold"
      :style="{ backgroundColor: bgColor, color: textColor }"
      @dblclick.stop="startEditing"
    >
      <template v-if="editing">
        <textarea
          ref="textarea"
          v-model="draftText"
          :maxlength="BOARD_ITEM_TEXT_MAX_LENGTH"
          class="nodrag h-full w-full resize-none overflow-hidden bg-transparent font-semibold outline-none"
          :style="{
            color: textColor,
            fontSize: `${fontSize}px`,
            fontFamily,
            textAlign,
          }"
          @pointerdown.stop
          @keydown.esc.stop.prevent="cancelEditing"
          @blur="commitEditing"
        />
      </template>
      <template v-else>
        <span
          ref="text"
          class="block w-full overflow-hidden break-words whitespace-pre-wrap"
          :style="{ fontSize: `${fontSize}px`, fontFamily, textAlign }"
          >{{ content.text }}</span
        >
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
      <Handle id="top" type="source" :position="Position.Top" class="board-connect-handle" />
      <Handle id="right" type="source" :position="Position.Right" class="board-connect-handle" />
      <Handle id="bottom" type="source" :position="Position.Bottom" class="board-connect-handle" />
      <Handle id="left" type="source" :position="Position.Left" class="board-connect-handle" />
    </template>
  </div>
</template>

<style scoped>
/* Стикер держится на тени, а не на обводке (референс `.design/main.html`) — заметно
   сильнее общей `--brand-shadow-card` (та калибрована под UI-панели, не бумагу) */
.board-sticky-content {
  box-shadow:
    0 1px 2px rgb(0 0 0 / 8%),
    0 6px 14px -6px rgb(0 0 0 / 18%);
}

/* Невидимы по умолчанию — появляются только при наведении на карточку, иначе
   маленькие точки по краям каждой карточки захламляли бы весь холст */
.board-connect-handle {
  width: 10px;
  height: 10px;
  background: var(--ui-primary);
  border: 2px solid var(--ui-bg);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.vue-flow__node:hover .board-connect-handle {
  opacity: 1;
}
</style>
