<script setup lang="ts">
/**
 * Модалка импорта личного стикер-пака из Telegram (21.6).
 * Переиспользуется: в BoardStickerPicker.vue (кнопка «Импорт из Telegram» —
 * общий флоу, пользователь сам вставляет ссылку/имя) и в BoardStickerNode.vue
 * (бейдж на чужом/осиротевшем стикере, §5.4 — конкретный пак уже известен
 * заранее по контенту стикера на доске).
 *
 * Если packTitle задан — режим «известного пака»: вместо поля ввода
 * показываем название пака текстом, вставлять ссылку не нужно (раньше поле
 * было readonly-инпутом с сырым telegramSetName — пользователь не понимал,
 * что это уже разрешённый пак, а не просьба вставить свою ссылку, нашли
 * живой проверкой). Согласие на использование чужих стикеров обязательно
 * в обоих режимах.
 */
import { useToast } from '@nuxt/ui/composables';
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../lib/api';
import { MODAL_BUTTON_UI, MODAL_INPUT_UI, MODAL_UI } from '../lib/modal-ui';
import { parseTelegramSetName } from '../features/boards/api/personal-stickers-api';
import { usePersonalStickerPacksStore } from '../stores/personal-sticker-packs';

const props = defineProps<{
  /** Предзаполненное имя стикер-сета (передаётся, когда импортируем конкретный пакет) */
  telegramSetName?: string;
  /** Человеческое название пака — задан вместе с telegramSetName в режиме «известного пака» */
  packTitle?: string;
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
  } catch (err) {
    // Сервер даёт конкретную причину отказа (лимит паков, пак целиком
    // анимированный/видео, не найден в Telegram и т.п., см.
    // PersonalStickersService.importFromTelegram) — без этого пользователь
    // видел одну и ту же общую фразу на любую причину и решал, что это баг
    // приложения, а не, например, «в паке только анимированные стикеры»
    const message = err instanceof ApiError ? err.message : t('board.stickerImportError');
    toast.add({ title: message, color: 'error' });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="t('board.stickerImportTitle')" :ui="MODAL_UI">
    <template #body>
      <div class="space-y-4">
        <p v-if="packTitle" class="text-[14px] text-[var(--brand-ink)]">
          {{ t('board.stickerImportKnownPackDescription', { title: packTitle }) }}
        </p>
        <UInput
          v-else
          v-model="setName"
          class="w-full"
          :placeholder="t('board.stickerImportPlaceholder')"
          :ui="MODAL_INPUT_UI"
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
          {{ t('common.cancel') }}
        </UButton>
        <UButton :loading="loading" :disabled="!canSubmit" :ui="MODAL_BUTTON_UI" @click="onSubmit">
          {{ loading ? t('board.stickerImportImporting') : t('board.stickerImportConfirm') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
