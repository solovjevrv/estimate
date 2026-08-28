<script setup lang="ts">
import { TEAM_NAME_MAX_LENGTH } from '@estimate/shared';
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import EntityTextModal from '../components/EntityTextModal.vue';
import { roleBadgeColor, teamAvatarColor } from '../lib/team-roles';
import { useAsyncAction } from '../composables/use-async-action';
import { useEntityModal } from '../composables/use-entity-modal';
import { useTeamsStore } from '../stores/teams';

const { t } = useI18n();
const router = useRouter();
const teams = useTeamsStore();

const loading = ref(true);
const loadFailed = ref(false);

const createTeamModal = useEntityModal();
const createFailed = ref(false);

// Закрыли модалку (отменой, Esc или после создания) — не оставляем внутри
// прежнее имя и старую ошибку до следующего открытия
watch(
  () => createTeamModal.open,
  (isOpen) => {
    if (!isOpen) {
      createFailed.value = false;
    }
  },
);

onMounted(async () => {
  try {
    await teams.loadList();
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
});

const { pending: submitting, execute: createTeam } = useAsyncAction({
  run: (name: string) => teams.create(name),
  success: async (team) => {
    createTeamModal.close();
    await router.push({ name: 'team', params: { id: team.id } });
  },
  error: () => {
    createFailed.value = true;
  },
});

async function onSubmit(name: string): Promise<void> {
  createFailed.value = false;
  await createTeam(name);
}
</script>

<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="font-heading text-3xl font-extrabold">{{ t('teams.title') }}</h1>
      <UButton
        size="lg"
        icon="i-lucide-plus"
        class="h-[43px] px-[22px] text-[15px] font-bold"
        @click="createTeamModal.show"
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
            <div class="min-w-0">
              <span class="block truncate text-lg font-bold">{{ team.name }}</span>
              <span class="text-muted text-[13.5px]">
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
      </li>
    </ul>

    <EntityTextModal
      v-model:open="createTeamModal.open"
      :title="t('teams.createTitle')"
      :label="t('common.nameLabel')"
      :placeholder="t('teams.namePlaceholder')"
      :max-length="TEAM_NAME_MAX_LENGTH"
      :required-message="t('common.nameRequired')"
      :too-long-message="t('common.nameTooLong', { max: TEAM_NAME_MAX_LENGTH })"
      :cancel-label="t('common.cancel')"
      :submit-label="t('teams.submit')"
      :pending="submitting"
      :error-message="createFailed ? t('teams.createError') : ''"
      @submit="onSubmit"
    />
  </section>
</template>
