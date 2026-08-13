<script setup lang="ts">
import type { BoardTemplate } from '@poker/shared';
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';

import { useBoardTemplatesStore } from '../../stores/board-templates';

const props = defineProps<{
  /** Только для вошедших пользователей — гость даже с edit-доступом по ссылке получит 401 на /api/board-templates */
  isAuthenticated: boolean;
}>();

const emit = defineEmits<{
  /** Выбран шаблон — применить его к доске */
  pick: [template: BoardTemplate];
  /** «Пустая доска» — просто скрыть галерею */
  dismiss: [];
}>();

const { t } = useI18n();
const templatesStore = useBoardTemplatesStore();

onMounted(() => {
  if (props.isAuthenticated) {
    void templatesStore.load();
  }
});

function templateLabel(template: BoardTemplate): string {
  return template.nameKey ? t(template.nameKey) : template.name;
}

function templateDescription(template: BoardTemplate): string | null {
  return template.descriptionKey ? t(template.descriptionKey) : template.description;
}
</script>

<template>
  <div
    v-if="isAuthenticated && templatesStore.loaded"
    class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30"
  >
    <div class="surface-card surface-card-lg mx-4 w-full max-w-3xl p-6">
      <h2 class="font-heading mb-4 text-2xl font-extrabold">{{ t('board.templates.pickerTitle') }}</h2>

      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          type="button"
          class="surface-card hover:bg-elevated/50 flex flex-col items-center gap-3 p-4 text-center"
          @click="emit('dismiss')"
        >
          <UIcon name="i-lucide-x" class="text-muted size-8" />
          <span class="font-medium">{{ t('board.templates.pickerBlankOption') }}</span>
        </button>

        <button
          v-for="template in templatesStore.templates"
          :key="template.id"
          type="button"
          class="surface-card hover:bg-elevated/50 flex flex-col items-center gap-3 p-4 text-center"
          @click="emit('pick', template)"
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

      <div class="flex justify-center">
        <UButton color="neutral" variant="outline" @click="emit('dismiss')">
          {{ t('teams.cancel') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
