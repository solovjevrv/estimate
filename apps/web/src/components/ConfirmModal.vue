<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import { MODAL_BUTTON_UI, MODAL_UI } from '../lib/modal-ui';

const props = withDefaults(
  defineProps<{
    title: string;
    description: string;
    confirmLabel: string;
    confirmColor?: 'error' | 'primary' | 'neutral' | 'success' | 'warning';
    loading?: boolean;
  }>(),
  { confirmColor: 'error', loading: false },
);

const emit = defineEmits<{ confirm: [] }>();
const open = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
</script>

<template>
  <UModal
    v-model:open="open"
    :title="props.title"
    :description="props.description"
    :ui="{ ...MODAL_UI, footer: `${MODAL_UI.footer} justify-end gap-2.5` }"
  >
    <template #footer="{ close }">
      <UButton color="neutral" variant="outline" :ui="MODAL_BUTTON_UI" @click="close">
        {{ t('common.cancel') }}
      </UButton>
      <UButton
        :color="props.confirmColor"
        :ui="MODAL_BUTTON_UI"
        :loading="props.loading"
        @click="emit('confirm')"
      >
        {{ props.confirmLabel }}
      </UButton>
    </template>
  </UModal>
</template>
