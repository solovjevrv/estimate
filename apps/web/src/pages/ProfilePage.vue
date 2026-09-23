<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BYTES,
  USER_JOB_TITLE_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
  trimText,
} from '@estimate/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import AvatarCropModal from '../components/AvatarCropModal.vue';
import { providerLabel } from '../lib/auth-provider';
import { roleBadgeColor, teamAvatarColor } from '../lib/team-roles';
import { useAsyncAction } from '../composables/use-async-action';
import { useSessionStore } from '../stores/session';
import { useTeamsStore } from '../stores/teams';

const { t } = useI18n();
const toast = useToast();
const session = useSessionStore();
const teams = useTeamsStore();

const form = reactive({ name: '', jobTitle: '' });

// --- Команды (10_Profile: карточка «Команды» под основной формой) ---
const teamsLoading = ref(true);
const teamsFailed = ref(false);

onMounted(async () => {
  teamsLoading.value = true;
  teamsFailed.value = false;
  try {
    await teams.loadList();
  } catch {
    teamsFailed.value = true;
  } finally {
    teamsLoading.value = false;
  }
});

// --- Аватарка (10.15) ---
const fileInput = ref<HTMLInputElement | null>(null);
const cropFile = ref<File | null>(null);
const cropOpen = ref(false);

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

const { pending: uploadingAvatar, execute: uploadAvatar } = useAsyncAction({
  run: (blob: Blob) => session.uploadAvatar(blob),
  success: () => {
    toast.add({ title: t('profile.avatar.saved'), color: 'success', icon: 'i-lucide-check' });
  },
  error: () => {
    toast.add({ title: t('profile.avatar.saveError'), color: 'error' });
  },
});

async function onCropConfirm(blob: Blob): Promise<void> {
  await uploadAvatar(blob);
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

const { pending: saving, execute: saveProfile } = useAsyncAction({
  run: ({ name, jobTitle }: { name: string; jobTitle: string }) =>
    session.updateProfile({ name: trimText(name), jobTitle: trimText(jobTitle) }),
  success: () => {
    toast.add({ title: t('profile.saved'), color: 'success', icon: 'i-lucide-check' });
  },
  error: () => {
    toast.add({ title: t('profile.saveError'), color: 'error' });
  },
});

async function onSubmit(event: FormSubmitEvent<{ name: string; jobTitle: string }>): Promise<void> {
  await saveProfile(event.data);
}
</script>

<template>
  <div v-if="session.user" class="mx-auto flex max-w-[480px] flex-col gap-6">
    <div class="bg-surface-block shadow-card flex flex-col items-center gap-6 rounded-r24 p-8">
      <UAvatar
        :src="session.user.avatarUrl ?? undefined"
        :alt="session.user.name"
        size="3xl"
        class="size-[100px] shrink-0"
        :class="teamAvatarColor(session.user.id)"
        :ui="{ fallback: 'font-heading text-[40px] font-bold text-white' }"
      />
      <input
        ref="fileInput"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        class="hidden"
        @change="onAvatarSelected"
      />

      <div class="flex flex-col items-center gap-2">
        <p class="text-text-brand text-sm font-medium">{{ session.user.email }}</p>
        <span class="badge-pill badge-pill-neutral">
          {{ providerLabel(session.user.provider) }}
        </span>
      </div>

      <UButton color="neutral" variant="outline" :loading="uploadingAvatar" @click="pickAvatar">
        {{ t('profile.avatar.change') }}
      </UButton>

      <UForm
        :state="form"
        :validate="validate"
        class="flex w-full flex-col gap-4"
        @submit="onSubmit"
      >
        <UFormField
          :label="t('profile.nameLabel')"
          name="name"
          :ui="{ label: 'text-sm font-bold' }"
        >
          <UInput
            v-model="form.name"
            class="w-full"
            :ui="{ base: 'bg-surface-frame border-border-strong' }"
          />
        </UFormField>
        <UFormField
          :label="t('profile.jobTitleLabel')"
          name="jobTitle"
          :ui="{ label: 'text-sm font-bold' }"
        >
          <UInput
            v-model="form.jobTitle"
            class="w-full"
            :placeholder="t('profile.jobTitlePlaceholder')"
            :ui="{ base: 'bg-surface-frame border-border-strong' }"
          />
        </UFormField>
        <UButton type="submit" :loading="saving" block>
          {{ saving ? t('profile.saving') : t('profile.save') }}
        </UButton>
      </UForm>
    </div>

    <div class="bg-surface-block shadow-card flex flex-col gap-5 rounded-r24 p-8">
      <h2 class="font-heading text-xl font-bold">{{ t('profile.teamsTitle') }}</h2>

      <div v-if="teamsLoading" class="text-muted flex justify-center py-2">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
      </div>
      <p v-else-if="teamsFailed" class="text-muted text-sm">{{ t('profile.teamsLoadError') }}</p>
      <template v-else-if="teams.list.length">
        <RouterLink
          v-for="team in teams.list"
          :key="team.id"
          :to="{ name: 'team', params: { id: team.id } }"
          class="flex w-full items-center justify-between gap-4"
        >
          <div class="flex min-w-0 items-center gap-4">
            <div
              class="font-heading flex size-[46px] shrink-0 items-center justify-center rounded-r12 text-base font-bold text-white"
              :class="teamAvatarColor(team.id)"
            >
              {{ team.name.slice(0, 1).toUpperCase() }}
            </div>
            <div class="min-w-0">
              <span class="block truncate text-lg font-bold">{{ team.name }}</span>
              <span class="text-muted text-sm">
                {{ t('teams.memberCount', { count: team.memberCount }, team.memberCount) }}
              </span>
            </div>
          </div>
          <span
            class="badge-pill shrink-0"
            :class="
              roleBadgeColor(team.role) === 'primary' ? 'badge-pill-primary' : 'badge-pill-neutral'
            "
          >
            {{ t(`role.${team.role}`) }}
          </span>
        </RouterLink>
      </template>
      <div v-else class="flex flex-col items-start gap-4 pt-2">
        <p class="text-lg font-bold">{{ t('profile.teamsEmptyTitle') }}</p>
        <p class="text-muted max-w-[340px] text-sm">{{ t('profile.teamsEmptyText') }}</p>
        <UButton block :to="{ name: 'teams' }">{{ t('profile.teamsEmptyAction') }}</UButton>
      </div>
    </div>
  </div>
  <p v-else class="text-muted text-center">{{ t('profile.notLoaded') }}</p>

  <AvatarCropModal v-model:open="cropOpen" :file="cropFile" @confirm="onCropConfirm" />
</template>
