<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { USER_JOB_TITLE_MAX_LENGTH, USER_NAME_MAX_LENGTH } from '@poker/shared';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const toast = useToast();
const session = useSessionStore();

const providerLabels: Record<string, string> = {
  google: 'Google',
  yandex: 'Яндекс',
};

const form = reactive({ name: '', jobTitle: '' });
const saving = ref(false);

watch(
  () => session.user,
  (user) => {
    form.name = user?.name ?? '';
    form.jobTitle = user?.jobTitle ?? '';
  },
  { immediate: true },
);

function validate(state: { name: string; jobTitle: string }): FormError[] {
  const errors: FormError[] = [];
  const name = state.name.trim();
  if (!name) {
    errors.push({ name: 'name', message: t('profile.nameRequired') });
  } else if (name.length > USER_NAME_MAX_LENGTH) {
    errors.push({ name: 'name', message: t('profile.nameTooLong', { max: USER_NAME_MAX_LENGTH }) });
  }
  if (state.jobTitle.trim().length > USER_JOB_TITLE_MAX_LENGTH) {
    errors.push({
      name: 'jobTitle',
      message: t('profile.jobTitleTooLong', { max: USER_JOB_TITLE_MAX_LENGTH }),
    });
  }
  return errors;
}

async function onSubmit(event: FormSubmitEvent<{ name: string; jobTitle: string }>): Promise<void> {
  saving.value = true;
  try {
    await session.updateProfile({
      name: event.data.name.trim(),
      jobTitle: event.data.jobTitle.trim(),
    });
    toast.add({ title: t('profile.saved'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('profile.saveError'), color: 'error' });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UCard v-if="session.user" class="mx-auto max-w-md">
    <div class="flex flex-col items-center gap-3 text-center">
      <UAvatar :src="session.user.avatarUrl ?? undefined" :alt="session.user.name" size="xl" />
      <p class="text-muted text-sm">{{ session.user.email }}</p>
      <UBadge color="neutral" variant="subtle">
        {{ providerLabels[session.user.provider] ?? session.user.provider }}
      </UBadge>
    </div>

    <UForm :state="form" :validate="validate" class="mt-6 space-y-4" @submit="onSubmit">
      <UFormField :label="t('profile.nameLabel')" name="name">
        <UInput v-model="form.name" class="w-full" />
      </UFormField>
      <UFormField :label="t('profile.jobTitleLabel')" name="jobTitle">
        <UInput
          v-model="form.jobTitle"
          class="w-full"
          :placeholder="t('profile.jobTitlePlaceholder')"
        />
      </UFormField>
      <UButton type="submit" :loading="saving" block>
        {{ saving ? t('profile.saving') : t('profile.save') }}
      </UButton>
    </UForm>
  </UCard>
  <p v-else class="text-muted text-center">{{ t('profile.notLoaded') }}</p>
</template>
