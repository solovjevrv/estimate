<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { TEAM_NAME_MAX_LENGTH } from '@poker/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { roleBadgeColor, teamAvatarColor } from '../lib/team-roles';
import { useTeamsStore } from '../stores/teams';

const { t } = useI18n();
const router = useRouter();
const teams = useTeamsStore();

const loading = ref(true);
const loadFailed = ref(false);

const open = ref(false);
const submitting = ref(false);
const createFailed = ref(false);
const state = reactive({ name: '' });

// Закрыли модалку (отменой, Esc или после создания) — не оставляем внутри
// прежнее имя и старую ошибку до следующего открытия
watch(open, (isOpen) => {
  if (!isOpen) {
    state.name = '';
    createFailed.value = false;
  }
});

onMounted(async () => {
  try {
    await teams.loadList();
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
});

/** Проверяем то же, что и сервер: непустое название в пределах длины. */
function validate(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = s.name.trim();
  if (!name) {
    errors.push({ name: 'name', message: t('teams.nameRequired') });
  } else if (name.length > TEAM_NAME_MAX_LENGTH) {
    errors.push({ name: 'name', message: t('teams.nameTooLong', { max: TEAM_NAME_MAX_LENGTH }) });
  }
  return errors;
}

async function onSubmit(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  submitting.value = true;
  createFailed.value = false;
  try {
    const team = await teams.create(event.data.name.trim());
    open.value = false;
    state.name = '';
    await router.push({ name: 'team', params: { id: team.id } });
  } catch {
    createFailed.value = true;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="space-y-6">
    <div class="flex items-center justify-between gap-4">
      <h1 class="font-heading text-3xl font-extrabold">{{ t('teams.title') }}</h1>
      <UButton
        size="lg"
        icon="i-lucide-plus"
        class="h-[43px] px-[22px] text-[15px] font-bold"
        @click="open = true"
      >
        {{ t('teams.create') }}
      </UButton>
    </div>

    <UAlert v-if="loadFailed" color="error" variant="subtle" :description="t('teams.loadError')" />

    <ul v-else-if="loading" class="flex flex-col gap-4">
      <li v-for="i in 3" :key="i" class="surface-card flex items-center gap-4 p-6">
        <USkeleton class="size-[46px] shrink-0 rounded-[12px] bg-[var(--brand-border)]" />
        <USkeleton class="h-5 w-1/3 bg-[var(--brand-border)]" />
      </li>
    </ul>

    <p v-else-if="teams.list.length === 0" class="text-muted">{{ t('teams.empty') }}</p>

    <ul v-else class="flex flex-col gap-4">
      <li v-for="team in teams.list" :key="team.id">
        <RouterLink
          :to="{ name: 'team', params: { id: team.id } }"
          class="surface-card surface-card-hover flex items-center justify-between gap-3 p-6"
        >
          <div class="flex min-w-0 items-center gap-4">
            <div
              class="font-heading flex size-[46px] shrink-0 items-center justify-center rounded-[12px] text-base font-bold text-white"
              :class="teamAvatarColor(team.id)"
            >
              {{ team.name.slice(0, 1).toUpperCase() }}
            </div>
            <span class="truncate text-lg font-bold">{{ team.name }}</span>
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
      </li>
    </ul>

    <UModal v-model:open="open" :title="t('teams.createTitle')">
      <template #body>
        <UForm :state="state" :validate="validate" class="space-y-4" @submit="onSubmit">
          <UAlert
            v-if="createFailed"
            color="error"
            variant="subtle"
            :description="t('teams.createError')"
          />

          <UFormField :label="t('teams.nameLabel')" name="name">
            <UInput
              v-model="state.name"
              :placeholder="t('teams.namePlaceholder')"
              :maxlength="TEAM_NAME_MAX_LENGTH"
              autofocus
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="open = false">
              {{ t('teams.cancel') }}
            </UButton>
            <UButton type="submit" :loading="submitting">{{ t('teams.submit') }}</UButton>
          </div>
        </UForm>
      </template>
    </UModal>
  </section>
</template>
