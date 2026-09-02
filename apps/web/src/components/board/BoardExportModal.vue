<script setup lang="ts">
/**
 * Модалка экспорта доски в PNG (15.5) — карточка 440px (макет
 * `boards_15_epic.html` изначально предлагал ещё и Markdown, снят по решению
 * пользователя 31.08.2026 как лишний — остался только формат PNG, без
 * карточек-вариантов). Настройки: отступ от края картинки (px, дефолт 24 —
 * добавлено по тому же решению, до этого было зашито 40px внутри
 * `use-board-export.ts`) и тоггл «только выделенную область». Сама модалка не
 * знает, как рендерится PNG — только эмиттит выбор и показывает `pending`,
 * переданный родителем (`use-board-export.ts` в `BoardCanvas.vue`, у которого
 * есть доступ к Vue Flow).
 */
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { MODAL_BUTTON_UI, MODAL_INPUT_UI, MODAL_UI } from '../../lib/modal-ui';

const props = defineProps<{
  boardTitle: string;
  itemCount: number;
  hasSelection: boolean;
  pending: boolean;
}>();

const emit = defineEmits<{
  download: [selectedOnly: boolean, marginPx: number];
}>();

const modelValue = defineModel<boolean>();
const { t } = useI18n();

const DEFAULT_MARGIN_PX = 24;
const MIN_MARGIN_PX = 0;
const MAX_MARGIN_PX = 400;

const selectedOnly = ref(false);
const marginPx = ref<number | null>(DEFAULT_MARGIN_PX);

// Тоггл смысла не имеет без выделения — форсируем выключенным, чтобы при
// закрытии/переоткрытии модалки без выделения не остался «залипший» on.
watch(
  () => props.hasSelection,
  (has) => {
    if (!has) selectedOnly.value = false;
  },
);

// Сброс на дефолт при каждом открытии — иначе повторный экспорт унаследует
// тоггл/отступ от прошлого запуска, что не соответствует форме "с нуля".
watch(modelValue, (open) => {
  if (open) {
    selectedOnly.value = false;
    marginPx.value = DEFAULT_MARGIN_PX;
  }
});

const EXPORT_MODAL_UI = {
  ...MODAL_UI,
  content: MODAL_UI.content.replace('max-w-[420px]', 'max-w-[440px]'),
};

function onDownload(): void {
  // UInputNumber сам клэмпит ввод по min/max — null возможен только если
  // поле оставили пустым (стёрли значение целиком)
  emit('download', selectedOnly.value, marginPx.value ?? DEFAULT_MARGIN_PX);
}
</script>

<template>
  <UModal
    v-model:open="modelValue"
    :title="t('board.exportTitle')"
    :description="pending ? undefined : boardTitle"
    :ui="EXPORT_MODAL_UI"
  >
    <template #body>
      <div v-if="pending" class="flex flex-col items-center py-2 text-center">
        <div class="board-export-spinner" />
        <p class="mt-[18px] text-[16px] font-bold">{{ t('board.exportPreparing') }}</p>
        <p class="text-muted mt-1.5 text-[13.5px]">
          {{ t('board.exportPreparingItemCount', { count: itemCount }) }}
        </p>
      </div>

      <div v-else class="space-y-[18px]">
        <div class="flex items-center justify-between gap-4">
          <span class="text-[14px] font-semibold">{{ t('board.exportMarginLabel') }}</span>
          <UInputNumber
            v-model="marginPx"
            :min="MIN_MARGIN_PX"
            :max="MAX_MARGIN_PX"
            class="w-28"
            :ui="{ base: MODAL_INPUT_UI.base }"
          />
        </div>

        <div class="flex items-center justify-between gap-4">
          <span class="text-[14px] font-semibold">{{ t('board.exportSelectedOnlyLabel') }}</span>
          <USwitch v-model="selectedOnly" :disabled="!hasSelection" />
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2.5">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="pending"
          :ui="MODAL_BUTTON_UI"
          @click="modelValue = false"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton :loading="pending" :ui="MODAL_BUTTON_UI" @click="onDownload">
          {{ t('board.exportDownload') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.board-export-spinner {
  width: 56px;
  height: 56px;
  border: 3px solid var(--brand-well-bg);
  border-top-color: var(--ui-primary);
  border-radius: 50%;
  animation: board-export-spin 0.8s linear infinite;
}

@keyframes board-export-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
