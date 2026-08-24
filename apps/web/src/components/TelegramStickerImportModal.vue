<script setup lang="ts">
/**
 * Модалка импорта личного стикер-пака из Telegram (21.6).
 * Переиспользуется: в BoardStickerPicker.vue (кнопка «Импорт из Telegram»)
 * и в BoardStickerNode.vue (бейдж на чужом паке, §5.4).
 *
 * Если telegramSetName задан — поле ввода только для чтения (импортируем
 * именно этот пакет). Согласие на использование чужих стикеров обязательно.
 */
import { useToast } from '@nuxt/ui/composables';
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { MODAL_BUTTON_UI, MODAL_INPUT_UI, MODAL_UI } from '../lib/modal-ui';
import { parseTelegramSetName } from '../features/boards/api/personal-stickers-api';
import { usePersonalStickerPacksStore } from '../stores/personal-sticker-packs';

const props = defineProps<{
  /** Предзаполненное имя стикер-сета (передаётся, когда импортируем конкретный пакет) */
  telegramSetName?: string;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'imported'): void;
}>();

const { t } = useI18n();
const toast = useToast();
const store = usePersonalStickerPacksStore();

const isOpen = defineModel<boolean>();
const setName = ref(props.telegramSetName ?? '');
const consent = ref(false);
const loading = ref(false);

const canSubmit = computed(
  () => consent.value && !loading.value && setName.value.trim().length > 0,
);

function close(): void {
  emit('update:modelValue', false);
}

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return;
  // Принимаем и голое имя (stickers), и ссылку (t.me/addstickers/stickers) —
  // сервер понимает только голое имя, парсим здесь (21.6, §5.2)
  const parsed = parseTelegramSetName(setName.value);
  if (!parsed) {
    toast.add({ title: t('board.stickerImportInvalidName'), color: 'error' });
    return;
  }
  loading.value = true;
  try {
    await store.importPack(parsed);
    toast.add({ title: t('board.stickerImportSuccess'), color: 'success' });
    emit('imported');
    close();
  } catch {
    toast.add({ title: t('board.stickerImportError'), color: 'error' });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="t('board.stickerImportTitle')" :ui="MODAL_UI">
    <template #body>
      <div class="space-y-4">
        <UInput
          v-model="setName"
          class="w-full"
          :placeholder="t('board.stickerImportPlaceholder')"
          :ui="MODAL_INPUT_UI"
          :readonly="!!telegramSetName"
        />
        <label class="flex items-start gap-2 text-[14px]">
          <UCheckbox v-model="consent" :ui="{ base: 'rounded-[5px]' }" />
          <span class="text-[var(--brand-ink2)]">{{ t('board.stickerImportConsentLabel') }}</span>
        </label>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" :ui="MODAL_BUTTON_UI" @click="close">
          {{ t('board.shareClose') }}
        </UButton>
        <UButton :loading="loading" :disabled="!canSubmit" :ui="MODAL_BUTTON_UI" @click="onSubmit">
          {{ loading ? t('board.stickerImportImporting') : t('board.stickerImportConfirm') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
