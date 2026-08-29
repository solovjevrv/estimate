<script setup lang="ts">
/**
 * Компартменты «атрибуты»/«операции» class/interface/enum (23.3) — только
 * отображение, только для чтения: редактирование содержимого — через
 * `BoardDiagramPropertiesPanel.vue` (боковая панель при выделении), не через
 * клик по самому узлу — иначе на маленьком боксе негде расположить поля
 * ввода для длинных списков атрибутов/операций.
 */
import { computed } from 'vue';
import type { UmlClassMember, UmlClassOperation, UmlVisibility } from '@estimate/shared';

const props = defineProps<{
  kind: 'class' | 'interface' | 'enum';
  attributes: UmlClassMember[];
  operations: UmlClassOperation[];
}>();

/** Канонические глифы видимости UML 2.5.1 §9.5.4 — не показываются у enum-литералов (видимость не имеет смысла) */
const VISIBILITY_GLYPH: Record<UmlVisibility, string> = {
  public: '+',
  private: '-',
  protected: '#',
  package: '~',
};

const isEnum = computed(() => props.kind === 'enum');
/** interface — атрибуты рендерятся, только если непустые (решение 23.1) */
const showAttributes = computed(() => props.kind !== 'interface' || props.attributes.length > 0);
</script>

<template>
  <div v-if="showAttributes" class="uml-compartment-section" data-testid="board-diagram-attributes">
    <div v-if="attributes.length === 0" class="uml-compartment-empty">—</div>
    <div v-for="(attr, index) in attributes" :key="index" class="uml-compartment-row">
      <span v-if="!isEnum">{{ VISIBILITY_GLYPH[attr.visibility] }}</span>
      {{ attr.name }}<span v-if="!isEnum && attr.dataType">: {{ attr.dataType }}</span>
    </div>
  </div>
  <div v-if="!isEnum" class="uml-compartment-section" data-testid="board-diagram-operations">
    <div v-if="operations.length === 0" class="uml-compartment-empty">—</div>
    <div v-for="(op, index) in operations" :key="index" class="uml-compartment-row">
      {{ VISIBILITY_GLYPH[op.visibility] }} {{ op.name }}()<span v-if="op.dataType"
        >: {{ op.dataType }}</span
      >
    </div>
  </div>
</template>

<style scoped>
.uml-compartment-section {
  width: 100%;
  padding: 4px 8px;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.5;
  text-align: left;
  border-top: 1px solid color-mix(in oklch, currentColor 30%, transparent);
}

.uml-compartment-row {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uml-compartment-empty {
  opacity: 0.4;
}
</style>
