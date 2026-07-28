<script setup lang="ts">
import { useI18n } from 'vue-i18n';

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
    :ui="{ footer: 'justify-end' }"
  >
    <template #footer="{ close }">
      <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
      <UButton :color="props.confirmColor" :loading="props.loading" @click="emit('confirm')">
        {{ props.confirmLabel }}
      </UButton>
    </template>
  </UModal>
</template>
