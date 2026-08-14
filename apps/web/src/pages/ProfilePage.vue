<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BYTES,
  USER_JOB_TITLE_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
  trimText,
} from '@poker/shared';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import AvatarCropModal from '../components/AvatarCropModal.vue';
import { providerLabel } from '../lib/auth-provider';
import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const toast = useToast();
const session = useSessionStore();

const form = reactive({ name: '', jobTitle: '' });
const saving = ref(false);

// --- Аватарка (10.15) ---
const fileInput = ref<HTMLInputElement | null>(null);
const cropFile = ref<File | null>(null);
const cropOpen = ref(false);
const uploadingAvatar = ref(false);

function pickAvatar(): void {
  fileInput.value?.click();
}

function onAvatarSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = ''; // тот же файл можно будет выбрать повторно

  if (!file) return;
  if (!(AVATAR_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    toast.add({ title: t('profile.avatar.invalidType'), color: 'error' });
    return;
  }
  if (file.size > AVATAR_MAX_BYTES) {
    toast.add({ title: t('profile.avatar.tooLarge'), color: 'error' });
    return;
  }

  cropFile.value = file;
  cropOpen.value = true;
}

async function onCropConfirm(blob: Blob): Promise<void> {
  uploadingAvatar.value = true;
  try {
    await session.uploadAvatar(blob);
    toast.add({ title: t('profile.avatar.saved'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('profile.avatar.saveError'), color: 'error' });
  } finally {
    uploadingAvatar.value = false;
  }
}

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
  const name = trimText(state.name);
  if (!name) {
    errors.push({ name: 'name', message: t('profile.nameRequired') });
  } else if (name.length > USER_NAME_MAX_LENGTH) {
    errors.push({ name: 'name', message: t('profile.nameTooLong', { max: USER_NAME_MAX_LENGTH }) });
  }
  if (trimText(state.jobTitle).length > USER_JOB_TITLE_MAX_LENGTH) {
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
      name: trimText(event.data.name),
      jobTitle: trimText(event.data.jobTitle),
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
  <div
    v-if="session.user"
    class="surface-card surface-card-lg mx-auto flex max-w-[480px] flex-col items-center px-[30px] py-[26px]"
  >
    <UAvatar
      :src="session.user.avatarUrl ?? undefined"
      :alt="session.user.name"
      class="mb-3 size-[100px]"
    />
    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      class="hidden"
      @change="onAvatarSelected"
    />
    <UButton
      color="neutral"
      variant="outline"
      size="sm"
      :loading="uploadingAvatar"
      class="mb-4 rounded-[9px] px-3.5 py-2 text-[13px] font-bold"
      @click="pickAvatar"
    >
      {{ t('profile.avatar.change') }}
    </UButton>
    <p class="mb-3 text-[15px] font-semibold" style="color: var(--ui-color-primary-500)">
      {{ session.user.email }}
    </p>
    <span class="badge-pill badge-pill-neutral mb-7">
      {{ providerLabel(session.user.provider) }}
    </span>

    <UForm :state="form" :validate="validate" class="w-full" @submit="onSubmit">
      <UFormField
        :label="t('profile.nameLabel')"
        name="name"
        class="mb-[18px]"
        :ui="{ label: 'text-sm font-bold mb-2' }"
      >
        <UInput
          v-model="form.name"
          class="w-full"
          :ui="{
            base: 'rounded-[11px] border-[1.5px] border-[var(--brand-border)] bg-[var(--brand-surface)] px-4 py-[13px] ring-0',
          }"
        />
      </UFormField>
      <UFormField
        :label="t('profile.jobTitleLabel')"
        name="jobTitle"
        class="mb-[26px]"
        :ui="{ label: 'text-sm font-bold mb-2' }"
      >
        <UInput
          v-model="form.jobTitle"
          class="w-full"
          :placeholder="t('profile.jobTitlePlaceholder')"
          :ui="{
            base: 'rounded-[11px] border-[1.5px] border-[var(--brand-border)] bg-[var(--brand-surface)] px-4 py-[13px] ring-0',
          }"
        />
      </UFormField>
      <UButton
        type="submit"
        :loading="saving"
        block
        class="rounded-[12px] py-[14px] text-[15px] font-bold"
      >
        {{ saving ? t('profile.saving') : t('profile.save') }}
      </UButton>
    </UForm>
  </div>
  <p v-else class="text-muted text-center">{{ t('profile.notLoaded') }}</p>

  <AvatarCropModal v-model:open="cropOpen" :file="cropFile" @confirm="onCropConfirm" />
</template>
