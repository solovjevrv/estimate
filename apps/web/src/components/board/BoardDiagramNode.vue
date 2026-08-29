<script setup lang="ts">
import { type BoardDiagramContent, getDiagramNodeSpec } from '@estimate/shared';
import type { BoardItem } from '@estimate/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer } from '@vue-flow/node-resizer';
import { computed, inject, ref, toRef } from 'vue';

import { BOARD_CAN_EDIT_KEY } from '../../features/boards/context/board-canvas-keys';
import { darkenHex } from '../../features/boards/domain/board-colors';
import { useBoardNodeEditing } from '../../features/boards/composables/use-board-node-editing';
import BoardEditingBadge from './shared/BoardEditingBadge.vue';
import BoardRichText from './BoardRichText.vue';

const props = defineProps<NodeProps<BoardItem>>();

const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));

const content = computed(() => props.data.content as BoardDiagramContent);

const spec = computed(() => getDiagramNodeSpec(content.value.notation, content.value.kind));

const {
  bgColor,
  textColor,
  fontFamily,
  textAlign,
  fontSize,
  displayRuns,
  editing,
  lockedBy,
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
  onResizeStart,
  onResize,
  onResizeEnd,
} = useBoardNodeEditing({
  itemId: props.id,
  data: toRef(props, 'data'),
  canEdit,
  isSelected: toRef(props, 'selected'),
  content,
  // Сохраняем все diagram-специфичные поля (attributes/operations/
  // eventDefinition у будущих 23.3/23.4 kind) — content патчится целиком
  // (23.1), пересборка только из type/notation/kind/text теряла бы их.
  buildContent: (text, runs) => ({
    ...content.value,
    text,
    ...(runs ? { runs } : {}),
  }),
  // lockAspectRatio читается динамически из DiagramNodeSpec (23.1), а не
  // жёстко зашит — actor требует пропорций, task — нет
  lockAspectRatio: spec.value?.lockAspectRatio ?? false,
});

const borderColor = computed(() => darkenHex(bgColor.value, 0.2));

/**
 * Визуальный значок/иконка для текущего kind диаграммы.
 * Для UML actor — палитра с человечком; для BPMN task — значок «выполнения».
 * Это placeholder: в 23.4 кастомные визуалы будут вынесены в отдельные
 * под-компоненты, а здесь — минимум, чтобы узел был отличимым и тестируемым.
 */
const diagramKindLabel = computed(() => {
  const { notation, kind } = content.value;
  if (notation === 'uml') {
    switch (kind) {
      case 'actor':
        return '👤';
      case 'use-case':
        return '⚪';
      default:
        return kind;
    }
  }
  // BPMN
  switch (kind) {
    case 'task':
      return '🔲';
    case 'subprocess':
      return '🔳';
    case 'gateway-exclusive':
      return '🔶';
    case 'gateway-parallel':
      return '🔷';
    case 'event-start':
      return '🔵';
    case 'event-intermediate':
      return '🟡';
    case 'event-end':
      return '🔴';
    default:
      return kind;
  }
});
</script>

<template>
  <div
    class="board-node-resizer-gap relative h-full w-full"
    data-testid="board-node-diagram"
    :data-node-id="props.id"
    :data-diagram-kind="content.kind"
    :data-selected="props.selected ? 'true' : 'false'"
  >
    <BoardEditingBadge v-if="lockedBy" :name="lockedBy.name" data-testid="board-editing-badge" />
    <NodeResizer
      v-if="spec"
      :is-visible="props.selected && !editing && canEdit && !lockedBy"
      :min-width="spec.minWidth"
      :min-height="spec.minHeight"
      :max-width="spec.maxWidth"
      :max-height="spec.maxHeight"
      :keep-aspect-ratio="spec.lockAspectRatio"
      @resize-start="onResizeStart"
      @resize="onResize"
      @resize-end="onResizeEnd"
    />
    <div
      ref="contentBox"
      data-testid="board-diagram-content"
      class="board-diagram-content flex h-full w-full items-center justify-center overflow-hidden p-4 text-center"
      :class="spec?.lockAspectRatio ? '' : 'rounded-lg'"
      :style="{ backgroundColor: bgColor, borderColor, color: textColor }"
      @dblclick.stop="startEditing"
    >
      <div class="absolute top-1 left-2 text-xs opacity-40">{{ diagramKindLabel }}</div>
      <div
        ref="text"
        class="relative block w-full overflow-hidden break-words"
        :style="{ fontSize: `${fontSize}px`, fontFamily, textAlign }"
      >
        <BoardRichText v-if="!editing" :runs="displayRuns" />
        <div
          v-else
          ref="editable"
          class="nodrag h-full w-full cursor-text overflow-hidden bg-transparent whitespace-pre-wrap outline-none"
          contenteditable="true"
          :style="{ color: textColor, fontSize: `${fontSize}px`, fontFamily, textAlign }"
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
      </div>
    </div>
    <!-- Связи (12.8) — см. пояснение в BoardShapeNode.vue -->
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

/* diagram-узел — плоский, без тени стикера и без жирного шрифта фигуры */
.board-diagram-content {
  border-width: 2px;
  border-style: solid;
}
</style>
