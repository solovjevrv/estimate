<script setup lang="ts">
import type { TeamMemberProfile } from '@estimate/shared';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../lib/api';
import { providerLabel } from '../lib/auth-provider';
import { roleBadgeColor, teamAvatarColor } from '../lib/team-roles';
import { useTeamsStore } from '../stores/teams';

const props = defineProps<{ id: string; userId: string }>();

const { t, locale } = useI18n();
const teams = useTeamsStore();

const member = ref<TeamMemberProfile | null>(null);
const loading = ref(true);
const notFound = ref(false);
const loadFailed = ref(false);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value);
}

// immediate — грузим при заходе; watch — на случай перехода между участниками
watch([() => props.id, () => props.userId], load, { immediate: true });

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  loadFailed.value = false;
  member.value = null;
  try {
    member.value = await teams.loadMember(props.id, props.userId);
  } catch (err) {
    // Не в команде, несуществующая команда/участник — сервер отвечает одинаково, 404
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true;
    } else {
      loadFailed.value = true;
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="space-y-5">
    <RouterLink
      :to="{ name: 'team', params: { id: props.id } }"
      class="text-muted hover:text-default inline-flex w-fit items-center gap-1.5 text-[14.5px] font-semibold"
    >
      <UIcon name="i-lucide-chevron-left" class="size-4" />
      {{ t('team.back') }}
    </RouterLink>

    <UAlert
      v-if="notFound"
      color="error"
      variant="subtle"
      :description="t('teamMember.notFound')"
    />
    <UAlert
      v-else-if="loadFailed"
      color="error"
      variant="subtle"
      :description="t('teamMember.loadError')"
    />

    <div
      v-else-if="loading"
      class="surface-card surface-card-lg mx-auto flex max-w-[480px] flex-col items-center px-[30px] py-[26px]"
    >
      <USkeleton class="mb-4 size-[100px] rounded-full bg-[var(--brand-border)]" />
      <USkeleton class="mb-3 h-5 w-1/2 bg-[var(--brand-border)]" />
      <USkeleton class="h-4 w-1/3 bg-[var(--brand-border)]" />
    </div>

    <div
      v-else-if="member"
      class="surface-card surface-card-lg mx-auto flex max-w-[480px] flex-col items-center px-[30px] py-[26px]"
    >
      <UAvatar
        :src="member.avatarUrl ?? undefined"
        :alt="member.name"
        size="3xl"
        class="mb-4 size-[100px]"
        :class="teamAvatarColor(member.userId)"
        :ui="{ fallback: 'font-heading text-xl font-bold text-white' }"
      />
      <h1 class="font-heading mb-1 text-xl font-extrabold">{{ member.name }}</h1>
      <p v-if="member.jobTitle" class="text-muted mb-3 text-[15px]">{{ member.jobTitle }}</p>
      <p
        v-if="member.email"
        class="mb-3 text-[15px] font-semibold"
        style="color: var(--ui-color-primary-500)"
      >
        {{ member.email }}
      </p>

      <div class="flex flex-wrap items-center justify-center gap-2">
        <span class="badge-pill badge-pill-neutral">{{ providerLabel(member.provider) }}</span>
        <span
          class="badge-pill"
          :class="
            roleBadgeColor(member.role) === 'primary' ? 'badge-pill-primary' : 'badge-pill-neutral'
          "
        >
          {{ t(`role.${member.role}`) }}
        </span>
      </div>

      <p class="text-muted mt-5 text-[13.5px]">
        {{ t('teamMember.joinedAt', { date: formatDate(member.joinedAt) }) }}
      </p>
    </div>
  </section>
</template>
