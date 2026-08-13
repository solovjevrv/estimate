<script setup lang="ts">
import type { BoardTemplate } from '@poker/shared';
import { Panel } from '@vue-flow/core';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { MODAL_UI } from '../../lib/modal-ui';
import { useBoardTemplatesStore } from '../../stores/board-templates';

defineProps<{
  /** Только для вошедших пользователей — гость даже с edit-доступом по ссылке получит 401 на /api/board-templates */
  isAuthenticated: boolean;
}>();

const emit = defineEmits<{
  /** Выбран шаблон — применить его к доске */
  pick: [template: BoardTemplate];
}>();

const { t } = useI18n();
const templatesStore = useBoardTemplatesStore();
const open = ref(false);

function openGallery(): void {
  void templatesStore.load();
  open.value = true;
}

function pick(template: BoardTemplate): void {
  open.value = false;
  emit('pick', template);
}

function templateLabel(template: BoardTemplate): string {
  return template.nameKey ? t(template.nameKey) : template.name;
}

function templateDescription(template: BoardTemplate): string | null {
  return template.descriptionKey ? t(template.descriptionKey) : template.description;
}
</script>

<template>
  <Panel v-if="isAuthenticated" position="bottom-center">
    <button
      type="button"
      class="surface-card flex items-center gap-2 px-4 py-2.5 text-sm font-semibold"
      @click="openGallery"
    >
      <UIcon name="i-lucide-layout-template" class="size-4 text-[var(--brand-ink)]" />
      {{ t('board.templates.pickerTrigger') }}
    </button>
  </Panel>

  <UModal v-model:open="open" :title="t('board.templates.pickerTitle')" :ui="MODAL_UI">
    <template #body>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          v-for="template in templatesStore.templates"
          :key="template.id"
          type="button"
          class="surface-card hover:bg-elevated/50 flex flex-col items-center gap-3 p-4 text-center"
          @click="pick(template)"
        >
          <UIcon name="i-lucide-layout-template" class="size-8 text-[var(--brand-ink)]" />
          <div class="flex flex-col">
            <span class="font-medium">{{ templateLabel(template) }}</span>
            <span v-if="templateDescription(template)" class="text-muted text-xs">
              {{ templateDescription(template) }}
            </span>
          </div>
        </button>
      </div>
    </template>
  </UModal>
</template>
