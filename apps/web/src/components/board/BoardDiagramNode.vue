<script setup lang="ts">
import {
  type BoardDiagramContent,
  type BoardDiagramUmlCompartmentContent,
  getDiagramNodeSpec,
} from '@estimate/shared';
import type { BoardItem } from '@estimate/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer } from '@vue-flow/node-resizer';
import { computed, inject, ref, toRef } from 'vue';

import { BOARD_CAN_EDIT_KEY } from '../../features/boards/context/board-canvas-keys';
import { darkenHex } from '../../features/boards/domain/board-colors';
import { useBoardNodeEditing } from '../../features/boards/composables/use-board-node-editing';
import BoardEditingBadge from './shared/BoardEditingBadge.vue';
import BoardRichText from './BoardRichText.vue';
import UmlActorShape from './diagrams/UmlActorShape.vue';
import UmlComponentIcon from './diagrams/UmlComponentIcon.vue';
import UmlCompartmentSections from './diagrams/UmlCompartmentSections.vue';
import UmlDatabaseShape from './diagrams/UmlDatabaseShape.vue';

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
  // Сохраняем все diagram-специфичные поля (attributes/operations у
  // class/interface/enum, eventDefinition у будущих 23.4 BPMN-событий) —
  // content патчится целиком (23.1), пересборка только из type/notation/
  // kind/text теряла бы их.
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
 * Визуальная категория рендера (23.3) — каждой соответствует своя разметка
 * ниже в шаблоне. BPMN-kind (кроме уже проведённого через стек `task`, тоже
 * попадающего сюда) остаются плейсхолдером до 23.4 — настоящие BPMN-трафареты
 * вне объёма этой задачи (см. PROGRESS.md, 23.3 vs 23.4).
 */
type DiagramVisualKind =
  'actor' | 'use-case' | 'component' | 'database' | 'compartment' | 'placeholder';
const visualKind = computed<DiagramVisualKind>(() => {
  const c = content.value;
  if (c.notation !== 'uml') return 'placeholder';
  switch (c.kind) {
    case 'actor':
      return 'actor';
    case 'use-case':
      return 'use-case';
    case 'component':
      return 'component';
    case 'database':
      return 'database';
    case 'class':
    case 'interface':
    case 'enum':
      return 'compartment';
    default:
      return 'placeholder';
  }
});

/** Приведение типа только для compartment-веток шаблона (v-if гарантирует применимость) */
const compartmentContent = computed(() => content.value as BoardDiagramUmlCompartmentContent);

const stereotypeLabel = computed(() => {
  const c = content.value;
  if (c.notation !== 'uml') return null;
  if (c.kind === 'interface') return '«interface»';
  if (c.kind === 'enum') return '«enumeration»';
  return null;
});

/**
 * Имя compartment-элемента — не «карточка, заполняющая весь бокс», а только
 * верхняя строка (остальное — атрибуты/операции), поэтому auto-fit шрифта
 * общего пайплайна (рассчитан на весь бокс, см. `use-fit-font-size.ts`) для
 * него неприменим напрямую: без ограничения он попытался бы растянуть шрифт
 * имени под ВЕСЬ бокс (включая место под compartments) на каждом ресайзе.
 * Верхняя граница держит имя читаемым заголовком фиксированного масштаба,
 * а не «на всю карточку» — `fontSize` из composable всё ещё нужен (участвует
 * в ручном режиме/кнопках тулбара +/-), просто визуально ограничен сверху.
 */
const COMPARTMENT_NAME_FONT_MAX = 16;
const compartmentNameFontSize = computed(() => Math.min(fontSize.value, COMPARTMENT_NAME_FONT_MAX));

/**
 * Значок/иконка placeholder-веток (BPMN-kind, 23.4 ещё не пришла) — прежнее
 * поведение 23.2, без изменений.
 */
const diagramKindLabel = computed(() => {
  const { notation, kind } = content.value;
  if (notation === 'uml') return kind;
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
      class="board-diagram-content relative flex h-full w-full flex-col overflow-hidden"
      :class="{ 'board-diagram-content-compartment': visualKind === 'compartment' }"
    >
      <!-- Фон/фигура — своя разметка на visualKind, текстовый оверлей ниже общий -->
      <UmlActorShape
        v-if="visualKind === 'actor'"
        class="board-diagram-actor-figure"
        :style="{ color: borderColor }"
      />
      <UmlDatabaseShape
        v-else-if="visualKind === 'database'"
        :fill="bgColor"
        :stroke="borderColor"
      />
      <div
        v-else-if="visualKind === 'use-case'"
        class="absolute inset-0 rounded-full border-2"
        :style="{ backgroundColor: bgColor, borderColor }"
      />
      <div
        v-else-if="visualKind === 'component'"
        class="absolute inset-0 rounded-lg border-2"
        :style="{ backgroundColor: bgColor, borderColor }"
      >
        <UmlComponentIcon
          class="board-diagram-component-icon"
          :style="{ color: borderColor, backgroundColor: bgColor }"
        />
      </div>
      <div
        v-else-if="visualKind === 'compartment'"
        class="absolute inset-0 border-2"
        :style="{ backgroundColor: bgColor, borderColor }"
      />
      <div
        v-else
        class="absolute inset-0 rounded-lg border-2"
        :style="{ backgroundColor: bgColor, borderColor }"
      >
        <div class="absolute top-1 left-2 text-xs opacity-40">{{ diagramKindLabel }}</div>
      </div>

      <!-- Текстовая метка/имя — общий блок для всех kind, позиция/размер меняются классом -->
      <div
        ref="text"
        class="board-diagram-label relative overflow-hidden break-words"
        :class="{
          'board-diagram-label-fill': visualKind !== 'actor' && visualKind !== 'compartment',
          'board-diagram-label-below': visualKind === 'actor',
          'board-diagram-label-name': visualKind === 'compartment',
        }"
        :style="{
          color: textColor,
          fontSize: `${visualKind === 'compartment' ? compartmentNameFontSize : fontSize}px`,
          fontFamily,
          textAlign: visualKind === 'compartment' ? 'left' : textAlign,
        }"
        @dblclick.stop="startEditing"
      >
        <div v-if="stereotypeLabel" class="board-diagram-stereotype">{{ stereotypeLabel }}</div>
        <BoardRichText v-if="!editing" :runs="displayRuns" />
        <div
          v-else
          ref="editable"
          class="nodrag h-full w-full cursor-text overflow-hidden bg-transparent whitespace-pre-wrap outline-none"
          contenteditable="true"
          :style="{ color: textColor, fontSize: 'inherit', fontFamily, textAlign: 'inherit' }"
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

      <UmlCompartmentSections
        v-if="visualKind === 'compartment'"
        :kind="compartmentContent.kind"
        :attributes="compartmentContent.attributes"
        :operations="compartmentContent.operations"
        :style="{ color: textColor }"
      />
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

.board-diagram-content-compartment {
  overflow: visible;
}

.board-diagram-actor-figure {
  position: absolute;
  top: 4%;
  left: 15%;
  width: 70%;
  height: 62%;
}

.board-diagram-component-icon {
  position: absolute;
  top: -4px;
  left: 10px;
}

.board-diagram-label {
  z-index: 1;
}

.board-diagram-label-fill {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
}

.board-diagram-label-below {
  position: absolute;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 34%;
  padding: 0 4px;
  text-align: center;
}

.board-diagram-label-name {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  padding: 6px 10px;
  font-weight: 600;
}

.board-diagram-stereotype {
  overflow: hidden;
  font-size: 10px;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.65;
}

.board-diagram-label-name :deep(> *) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
