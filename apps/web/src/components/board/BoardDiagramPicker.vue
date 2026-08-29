<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { BoardDiagramKind, BoardDiagramNotation } from '@estimate/shared';

const emit = defineEmits<{
  select: [notation: BoardDiagramNotation, kind: BoardDiagramKind];
}>();

const { t } = useI18n();

/**
 * Список kind, доступных из тулбара (23.2) — ровно те два, что проведены
 * через весь стек (валидация/резайз/undo/realtime): UML actor и BPMN task.
 * Остальные kind из DIAGRAM_NODE_SPECS появятся здесь по мере 23.3 (UML) /
 * 23.4 (BPMN), когда для них будут готовы настоящие SVG-трафареты.
 */
const OPTIONS: Array<{
  notation: BoardDiagramNotation;
  kind: BoardDiagramKind;
  icon: string;
  labelKey: string;
}> = [
  { notation: 'uml', kind: 'actor', icon: 'i-lucide-user', labelKey: 'board.toolDiagramUmlActor' },
  {
    notation: 'bpmn',
    kind: 'task',
    icon: 'i-lucide-square-check',
    labelKey: 'board.toolDiagramBpmnTask',
  },
];
</script>

<template>
  <div class="board-diagram-picker" data-testid="board-diagram-picker">
    <button
      v-for="option in OPTIONS"
      :key="`${option.notation}-${option.kind}`"
      type="button"
      class="board-diagram-picker-item"
      :data-testid="`board-diagram-picker-${option.notation}-${option.kind}`"
      @click="emit('select', option.notation, option.kind)"
    >
      <UIcon :name="option.icon" class="size-[18px]" />
      <span>{{ t(option.labelKey) }}</span>
    </button>
  </div>
</template>

<style scoped>
.board-diagram-picker {
  display: flex;
  min-width: 170px;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
}

.board-diagram-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  color: var(--brand-ink);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 13px;
}

.board-diagram-picker-item:hover {
  background: var(--ui-bg-elevated);
}
</style>
