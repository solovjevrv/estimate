<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CircleStencil, Cropper } from 'vue-advanced-cropper';
import 'vue-advanced-cropper/dist/style.css';

import { MODAL_BUTTON_UI, MODAL_UI } from '../lib/modal-ui';

const props = defineProps<{ file: File | null }>();
const emit = defineEmits<{ confirm: [Blob] }>();
const open = defineModel<boolean>('open', { required: true });

const { t } = useI18n();

// Шире дефолтной модалки (420px) — кропперу нужно место для картинки и рамки
const cropModalUi = {
  ...MODAL_UI,
  content: MODAL_UI.content.replace('max-w-[420px]', 'max-w-[520px]'),
  footer: `${MODAL_UI.footer} justify-end gap-2.5`,
};

const cropperRef = ref<InstanceType<typeof Cropper> | null>(null);
const imageSrc = ref<string | null>(null);
const confirming = ref(false);
// Cropper строит внутренний canvas асинхронно после загрузки картинки — до этого
// getResult().canvas пуст; кнопка недоступна, пока не пришло собственное событие ready
const cropperReady = ref(false);

watch(
  () => props.file,
  (file) => {
    if (imageSrc.value) URL.revokeObjectURL(imageSrc.value);
    cropperReady.value = false;
    imageSrc.value = file ? URL.createObjectURL(file) : null;
  },
);

onBeforeUnmount(() => {
  if (imageSrc.value) URL.revokeObjectURL(imageSrc.value);
});

async function confirm(close: () => void): Promise<void> {
  const canvas = cropperRef.value?.getResult().canvas;
  if (!canvas) return;

  confirming.value = true;
  try {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.9),
    );
    if (blob) {
      emit('confirm', blob);
      close();
    }
  } finally {
    confirming.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="t('profile.avatar.cropTitle')" :ui="cropModalUi">
    <template #body>
      <div class="h-[360px] overflow-hidden rounded-[12px] bg-[var(--brand-border)]">
        <Cropper
          v-if="imageSrc"
          ref="cropperRef"
          class="h-full w-full"
          :src="imageSrc"
          :stencil-component="CircleStencil"
          :stencil-props="{ aspectRatio: 1 }"
          @ready="cropperReady = true"
        />
      </div>
    </template>

    <template #footer="{ close }">
      <UButton color="neutral" variant="outline" :ui="MODAL_BUTTON_UI" @click="close">
        {{ t('profile.avatar.cropCancel') }}
      </UButton>
      <UButton
        :ui="MODAL_BUTTON_UI"
        :loading="confirming"
        :disabled="!cropperReady"
        @click="confirm(close)"
      >
        {{ t('profile.avatar.cropConfirm') }}
      </UButton>
    </template>
  </UModal>
</template>
