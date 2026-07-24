<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { TEAM_NAME_MAX_LENGTH } from '@poker/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { roleBadgeColor } from '../lib/team-roles';
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
      <h1 class="text-2xl font-semibold">{{ t('teams.title') }}</h1>
      <UButton icon="i-lucide-plus" @click="open = true">{{ t('teams.create') }}</UButton>
    </div>

    <UAlert v-if="loadFailed" color="error" variant="subtle" :description="t('teams.loadError')" />

    <div v-else-if="loading" class="text-muted flex justify-center py-8">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
    </div>

    <p v-else-if="teams.list.length === 0" class="text-muted">{{ t('teams.empty') }}</p>

    <ul v-else class="grid gap-3 sm:grid-cols-2">
      <li v-for="team in teams.list" :key="team.id">
        <RouterLink :to="{ name: 'team', params: { id: team.id } }" class="block">
          <UCard class="hover:ring-primary transition hover:ring-1">
            <div class="flex items-center justify-between gap-3">
              <span class="font-medium">{{ team.name }}</span>
              <UBadge :color="roleBadgeColor(team.role)" variant="subtle">
                {{ t(`role.${team.role}`) }}
              </UBadge>
            </div>
          </UCard>
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
