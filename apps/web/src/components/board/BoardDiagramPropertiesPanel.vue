<script setup lang="ts">
/**
 * Боковая панель свойств class/interface/enum (23.3) — показывается родителем
 * (`BoardCanvas.vue`), когда выделен ровно один diagram-элемент такого kind.
 * Логика черновика/коммита/блокировки — в `use-board-diagram-properties.ts`,
 * здесь только форма. `:key` на использовании этого компонента в
 * `BoardCanvas.vue` обязателен (id элемента) — без remount при переключении
 * между двумя выделенными class-элементами подряд composable продолжил бы
 * жить со старым `itemId`, зафиксированным в замыкании при первом монтировании.
 */
import { Panel } from '@vue-flow/core';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BoardDiagramUmlCompartmentContent, UmlVisibility } from '@estimate/shared';
import { UML_VISIBILITIES } from '@estimate/shared';

import { useBoardDiagramProperties } from '../../features/boards/composables/use-board-diagram-properties';

const props = defineProps<{
  itemId: string;
  canEdit: boolean;
  content: BoardDiagramUmlCompartmentContent;
}>();

const { t } = useI18n();

const canEditRef = computed(() => props.canEdit);
const {
  isEnum,
  attributes,
  operations,
  lockedBy,
  canAddAttribute,
  canAddOperation,
  addAttribute,
  removeAttribute,
  addOperation,
  removeOperation,
  commit,
  onPanelFocusIn,
  onPanelFocusOut,
  nameMaxLength,
  dataTypeMaxLength,
} = useBoardDiagramProperties({
  itemId: props.itemId,
  canEdit: canEditRef,
  content: toRef(props, 'content'),
});

const disabled = computed(() => !props.canEdit || !!lockedBy.value);

const KIND_LABEL_KEY: Record<'class' | 'interface' | 'enum', string> = {
  class: 'board.toolDiagramUmlClass',
  interface: 'board.toolDiagramUmlInterface',
  enum: 'board.toolDiagramUmlEnum',
};
const title = computed(() => props.content.text || t(KIND_LABEL_KEY[props.content.kind]));

const VISIBILITY_LABEL_KEY: Record<UmlVisibility, string> = {
  public: 'board.umlVisibilityPublic',
  private: 'board.umlVisibilityPrivate',
  protected: 'board.umlVisibilityProtected',
  package: 'board.umlVisibilityPackage',
};

const panelEl = ref<HTMLElement | null>(null);

function blurOnEnter(event: KeyboardEvent): void {
  (event.target as HTMLElement).blur();
}
</script>

<template>
  <Panel position="top-right">
    <div
      ref="panelEl"
      class="board-diagram-properties"
      data-testid="board-diagram-properties-panel"
      @focusin="onPanelFocusIn"
      @focusout="onPanelFocusOut($event, panelEl)"
    >
      <header class="board-diagram-properties-header">
        <span class="board-diagram-properties-title">{{ title }}</span>
        <span v-if="lockedBy" class="board-diagram-properties-lock">
          {{ t('board.editingBy', { name: lockedBy.name }) }}
        </span>
      </header>

      <section class="board-diagram-properties-section">
        <h4 class="board-diagram-properties-heading">
          {{
            isEnum
              ? t('board.diagramPropertiesLiteralsHeading')
              : t('board.diagramPropertiesAttributesHeading')
          }}
        </h4>
        <div
          v-for="(row, index) in attributes"
          :key="index"
          class="board-diagram-properties-row"
          data-testid="board-diagram-properties-attribute-row"
        >
          <input
            v-model="row.name"
            class="board-diagram-properties-input board-diagram-properties-input-name"
            data-testid="board-diagram-properties-name"
            :maxlength="nameMaxLength"
            :disabled="disabled"
            :placeholder="t('board.diagramPropertiesNamePlaceholder')"
            @blur="commit"
            @keydown.enter="blurOnEnter"
          />
          <template v-if="!isEnum">
            <input
              v-model="row.dataType"
              class="board-diagram-properties-input board-diagram-properties-input-type"
              data-testid="board-diagram-properties-datatype"
              :maxlength="dataTypeMaxLength"
              :disabled="disabled"
              :placeholder="t('board.diagramPropertiesTypePlaceholder')"
              @blur="commit"
              @keydown.enter="blurOnEnter"
            />
            <select
              v-model="row.visibility"
              class="board-diagram-properties-select"
              data-testid="board-diagram-properties-visibility"
              :disabled="disabled"
              @change="commit"
            >
              <option v-for="visibility in UML_VISIBILITIES" :key="visibility" :value="visibility">
                {{ t(VISIBILITY_LABEL_KEY[visibility]) }}
              </option>
            </select>
          </template>
          <button
            type="button"
            class="board-diagram-properties-remove"
            :disabled="disabled"
            :aria-label="t('board.diagramPropertiesRemoveLabel')"
            @click="removeAttribute(index)"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
          </button>
        </div>
        <button
          type="button"
          class="board-diagram-properties-add"
          data-testid="board-diagram-properties-add-attribute"
          :disabled="disabled || !canAddAttribute"
          @click="addAttribute"
        >
          <UIcon name="i-lucide-plus" class="size-3.5" />
          {{
            isEnum
              ? t('board.diagramPropertiesAddLiteral')
              : t('board.diagramPropertiesAddAttribute')
          }}
        </button>
      </section>

      <section v-if="!isEnum" class="board-diagram-properties-section">
        <h4 class="board-diagram-properties-heading">
          {{ t('board.diagramPropertiesOperationsHeading') }}
        </h4>
        <div
          v-for="(row, index) in operations"
          :key="index"
          class="board-diagram-properties-row"
          data-testid="board-diagram-properties-operation-row"
        >
          <input
            v-model="row.name"
            class="board-diagram-properties-input board-diagram-properties-input-name"
            data-testid="board-diagram-properties-name"
            :maxlength="nameMaxLength"
            :disabled="disabled"
            :placeholder="t('board.diagramPropertiesNamePlaceholder')"
            @blur="commit"
            @keydown.enter="blurOnEnter"
          />
          <input
            v-model="row.dataType"
            class="board-diagram-properties-input board-diagram-properties-input-type"
            data-testid="board-diagram-properties-datatype"
            :maxlength="dataTypeMaxLength"
            :disabled="disabled"
            :placeholder="t('board.diagramPropertiesTypePlaceholder')"
            @blur="commit"
            @keydown.enter="blurOnEnter"
          />
          <select
            v-model="row.visibility"
            class="board-diagram-properties-select"
            data-testid="board-diagram-properties-visibility"
            :disabled="disabled"
            @change="commit"
          >
            <option v-for="visibility in UML_VISIBILITIES" :key="visibility" :value="visibility">
              {{ t(VISIBILITY_LABEL_KEY[visibility]) }}
            </option>
          </select>
          <button
            type="button"
            class="board-diagram-properties-remove"
            :disabled="disabled"
            :aria-label="t('board.diagramPropertiesRemoveLabel')"
            @click="removeOperation(index)"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
          </button>
        </div>
        <button
          type="button"
          class="board-diagram-properties-add"
          data-testid="board-diagram-properties-add-operation"
          :disabled="disabled || !canAddOperation"
          @click="addOperation"
        >
          <UIcon name="i-lucide-plus" class="size-3.5" />
          {{ t('board.diagramPropertiesAddOperation') }}
        </button>
      </section>
    </div>
  </Panel>
</template>

<style scoped>
.board-diagram-properties {
  width: 280px;
  max-height: 70vh;
  padding: 10px;
  overflow-y: auto;
  background: var(--brand-surface);
  border-radius: 12px;
  box-shadow: var(--brand-shadow-card);
}

.board-diagram-properties-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.board-diagram-properties-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-diagram-properties-lock {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--brand-ink2);
}

.board-diagram-properties-section {
  padding-top: 10px;
  border-top: 1px solid var(--ui-border);
}

.board-diagram-properties-section:first-of-type {
  padding-top: 0;
  border-top: none;
}

.board-diagram-properties-heading {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--brand-ink2);
}

.board-diagram-properties-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.board-diagram-properties-input {
  min-width: 0;
  padding: 4px 6px;
  font-size: 12px;
  background: var(--ui-bg-elevated);
  border: 1px solid transparent;
  border-radius: 6px;
  outline: none;
}

.board-diagram-properties-input:focus {
  border-color: var(--ui-primary);
}

.board-diagram-properties-input-name {
  flex: 1;
}

.board-diagram-properties-input-type {
  width: 64px;
  flex-shrink: 0;
}

.board-diagram-properties-select {
  flex-shrink: 0;
  width: 74px;
  padding: 4px 2px;
  font-size: 11px;
  background: var(--ui-bg-elevated);
  border: 1px solid transparent;
  border-radius: 6px;
  outline: none;
}

.board-diagram-properties-remove {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--brand-ink2);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
}

.board-diagram-properties-remove:hover:not(:disabled) {
  color: var(--ui-error, #e11d48);
  background: var(--ui-bg-elevated);
}

.board-diagram-properties-add {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--brand-ink2);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
}

.board-diagram-properties-add:hover:not(:disabled) {
  color: var(--brand-ink);
  background: var(--ui-bg-elevated);
}

.board-diagram-properties-add:disabled,
.board-diagram-properties-input:disabled,
.board-diagram-properties-select:disabled,
.board-diagram-properties-remove:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
