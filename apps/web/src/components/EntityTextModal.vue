<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { trimText } from '@estimate/shared';
import { computed, reactive, watch } from 'vue';

import { nextEntityModalValue } from '../lib/entity-text-modal';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    label: string;
    submitLabel: string;
    cancelLabel: string;
    requiredMessage: string;
    tooLongMessage: string;
    maxLength: number;
    initialValue?: string;
    placeholder?: string;
    pending?: boolean;
    errorMessage?: string;
  }>(),
  { initialValue: '', placeholder: '', pending: false, errorMessage: '' },
);

const emit = defineEmits<{
  'update:open': [value: boolean];
  submit: [value: string];
}>();

const modalOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});
const state = reactive({ value: '' });

watch(
  () => props.open,
  (isOpen) => {
    state.value = nextEntityModalValue(isOpen, props.initialValue, state.value);
  },
);

function validate(form: { value: string }): FormError[] {
  const value = trimText(form.value);
  if (!value) return [{ name: 'value', message: props.requiredMessage }];
  if (value.length > props.maxLength) return [{ name: 'value', message: props.tooLongMessage }];
  return [];
}

function onSubmit(event: FormSubmitEvent<{ value: string }>): void {
  emit('submit', trimText(event.data.value));
}
</script>

<template>
  <UModal v-model:open="modalOpen" :title="title">
    <template #body>
      <UForm :state="state" :validate="validate" class="space-y-4" @submit="onSubmit">
        <UAlert v-if="errorMessage" color="error" variant="subtle" :description="errorMessage" />
        <UFormField :label="label" name="value">
          <UInput
            v-model="state.value"
            :placeholder="placeholder"
            :maxlength="maxLength"
            autofocus
            class="w-full"
          />
        </UFormField>
        <div class="flex justify-end gap-2.5">
          <UButton color="neutral" variant="outline" @click="modalOpen = false">
            {{ cancelLabel }}
          </UButton>
          <UButton type="submit" :loading="pending">
            {{ submitLabel }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
