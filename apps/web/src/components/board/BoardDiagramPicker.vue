<script setup lang="ts">
/**
 * Содержимое поповера «Диаграммы» (23.2, редизайн 23.3) — группы по нотации
 * (UML/BPMN), поиск по названию и «недавние» (localStorage, без БД — тот же
 * принцип, что у `BoardStickerPicker.vue`). BPMN пока даёт ровно один kind
 * (`task`, проведён через весь стек в 23.2) — остальные 10 появятся в 23.4
 * вместе с настоящими SVG-трафаретами.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BoardDiagramKind, BoardDiagramNotation } from '@estimate/shared';

import {
  addRecentDiagramTool,
  getRecentDiagramTools,
} from '../../features/boards/infrastructure/recent-diagram-tools';

const emit = defineEmits<{
  select: [notation: BoardDiagramNotation, kind: BoardDiagramKind];
}>();

const { t } = useI18n();

interface DiagramToolOption {
  notation: BoardDiagramNotation;
  kind: BoardDiagramKind;
  icon: string;
  labelKey: string;
}

/**
 * UML — все 7 kind каталога (23.1), с настоящими SVG-трафаретами (23.3).
 * BPMN — пока только `task` (23.2); остальные 10 kind добавит 23.4.
 */
const UML_OPTIONS: DiagramToolOption[] = [
  { notation: 'uml', kind: 'actor', icon: 'i-lucide-user', labelKey: 'board.toolDiagramUmlActor' },
  {
    notation: 'uml',
    kind: 'use-case',
    icon: 'i-lucide-circle',
    labelKey: 'board.toolDiagramUmlUseCase',
  },
  {
    notation: 'uml',
    kind: 'class',
    icon: 'i-lucide-square',
    labelKey: 'board.toolDiagramUmlClass',
  },
  {
    notation: 'uml',
    kind: 'interface',
    icon: 'i-lucide-square-dashed',
    labelKey: 'board.toolDiagramUmlInterface',
  },
  { notation: 'uml', kind: 'enum', icon: 'i-lucide-list', labelKey: 'board.toolDiagramUmlEnum' },
  {
    notation: 'uml',
    kind: 'component',
    icon: 'i-lucide-box',
    labelKey: 'board.toolDiagramUmlComponent',
  },
  {
    notation: 'uml',
    kind: 'database',
    icon: 'i-lucide-database',
    labelKey: 'board.toolDiagramUmlDatabase',
  },
];

const BPMN_OPTIONS: DiagramToolOption[] = [
  {
    notation: 'bpmn',
    kind: 'task',
    icon: 'i-lucide-square-check',
    labelKey: 'board.toolDiagramBpmnTask',
  },
];

const ALL_OPTIONS = [...UML_OPTIONS, ...BPMN_OPTIONS];

const query = ref('');
const recentItems = ref<DiagramToolOption[]>([]);

function refreshRecent(): void {
  recentItems.value = getRecentDiagramTools()
    .map((ref) => ALL_OPTIONS.find((o) => o.notation === ref.notation && o.kind === ref.kind))
    .filter((option): option is DiagramToolOption => option !== undefined);
}

onMounted(refreshRecent);

const normalizedQuery = computed(() => query.value.trim().toLowerCase());

function matches(option: DiagramToolOption): boolean {
  if (!normalizedQuery.value) return true;
  return t(option.labelKey).toLowerCase().includes(normalizedQuery.value);
}

const filteredUml = computed(() => UML_OPTIONS.filter(matches));
const filteredBpmn = computed(() => BPMN_OPTIONS.filter(matches));
const hasResults = computed(() => filteredUml.value.length > 0 || filteredBpmn.value.length > 0);

function pick(notation: BoardDiagramNotation, kind: BoardDiagramKind): void {
  addRecentDiagramTool(notation, kind);
  // Реф recentItems обновляем сразу — UPopover не гарантированно размонтирует
  // #content при закрытии (тот же нюанс, что у BoardStickerPicker.vue)
  refreshRecent();
  emit('select', notation, kind);
}
</script>

<template>
  <div class="board-diagram-picker" data-testid="board-diagram-picker">
    <UInput
      v-model="query"
      :placeholder="t('board.diagramPickerSearchPlaceholder')"
      icon="i-lucide-search"
      size="sm"
      class="board-diagram-picker-search"
    />

    <div class="board-diagram-picker-scroll">
      <section
        v-if="!normalizedQuery && recentItems.length > 0"
        class="board-diagram-picker-section"
      >
        <h4 class="board-diagram-picker-heading">{{ t('board.stickerRecentLabel') }}</h4>
        <button
          v-for="option in recentItems"
          :key="`recent-${option.notation}-${option.kind}`"
          type="button"
          class="board-diagram-picker-item"
          :data-testid="`board-diagram-picker-${option.notation}-${option.kind}`"
          @click="pick(option.notation, option.kind)"
        >
          <UIcon :name="option.icon" class="size-[18px]" />
          <span>{{ t(option.labelKey) }}</span>
        </button>
      </section>

      <section v-if="filteredUml.length > 0" class="board-diagram-picker-section">
        <h4 class="board-diagram-picker-heading">{{ t('board.diagramPickerGroupUml') }}</h4>
        <button
          v-for="option in filteredUml"
          :key="`${option.notation}-${option.kind}`"
          type="button"
          class="board-diagram-picker-item"
          :data-testid="`board-diagram-picker-${option.notation}-${option.kind}`"
          @click="pick(option.notation, option.kind)"
        >
          <UIcon :name="option.icon" class="size-[18px]" />
          <span>{{ t(option.labelKey) }}</span>
        </button>
      </section>

      <section v-if="filteredBpmn.length > 0" class="board-diagram-picker-section">
        <h4 class="board-diagram-picker-heading">{{ t('board.diagramPickerGroupBpmn') }}</h4>
        <button
          v-for="option in filteredBpmn"
          :key="`${option.notation}-${option.kind}`"
          type="button"
          class="board-diagram-picker-item"
          :data-testid="`board-diagram-picker-${option.notation}-${option.kind}`"
          @click="pick(option.notation, option.kind)"
        >
          <UIcon :name="option.icon" class="size-[18px]" />
          <span>{{ t(option.labelKey) }}</span>
        </button>
      </section>

      <p v-if="!hasResults" class="board-diagram-picker-empty">
        {{ t('board.diagramPickerEmpty') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.board-diagram-picker {
  display: flex;
  flex-direction: column;
  width: 220px;
  padding: 6px;
}

.board-diagram-picker-search {
  flex-shrink: 0;
  margin-bottom: 4px;
}

.board-diagram-picker-scroll {
  max-height: 320px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border) transparent;
}

.board-diagram-picker-section {
  padding: 6px 0;
}

.board-diagram-picker-heading {
  margin: 0 0 2px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--brand-ink2);
}

.board-diagram-picker-item {
  display: flex;
  width: 100%;
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

.board-diagram-picker-empty {
  padding: 10px;
  font-size: 12px;
  color: var(--brand-ink2);
  text-align: center;
}
</style>
