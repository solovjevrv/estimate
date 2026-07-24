<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../lib/api';
import { roleBadgeColor } from '../lib/team-roles';
import { useTeamsStore } from '../stores/teams';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const toast = useToast();
const teams = useTeamsStore();

const loading = ref(true);
const notFound = ref(false);
const loadFailed = ref(false);

const overview = computed(() => teams.current);

/** Код приходит только админу и владельцу — по нему и показываем блок приглашения */
const inviteUrl = computed(() =>
  overview.value?.inviteCode
    ? `${window.location.origin}/invite/${overview.value.inviteCode}`
    : null,
);

// immediate — грузим при заходе; watch — на случай перехода между командами,
// когда vue-router переиспользует компонент и onMounted повторно не срабатывает
watch(() => props.id, load, { immediate: true });

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  loadFailed.value = false;
  try {
    await teams.loadTeam(props.id);
  } catch (err) {
    // Посторонним и на несуществующую команду сервер отвечает одинаково — 404
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true;
    } else {
      loadFailed.value = true;
    }
  } finally {
    loading.value = false;
  }
}

async function copyInvite(): Promise<void> {
  if (!inviteUrl.value) return;
  try {
    await navigator.clipboard.writeText(inviteUrl.value);
    toast.add({ title: t('team.copied'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('team.copyFailed'), color: 'error' });
  }
}

const rotateOpen = ref(false);
const rotating = ref(false);

async function rotate(): Promise<void> {
  rotating.value = true;
  try {
    await teams.rotateInvite(props.id);
    toast.add({ title: t('team.rotated'), color: 'success', icon: 'i-lucide-check' });
    rotateOpen.value = false;
  } catch {
    toast.add({ title: t('team.rotateError'), color: 'error' });
  } finally {
    rotating.value = false;
  }
}
</script>

<template>
  <section class="space-y-6">
    <RouterLink :to="{ name: 'teams' }" class="text-muted hover:text-default inline-flex text-sm">
      ← {{ t('team.back') }}
    </RouterLink>

    <UAlert v-if="notFound" color="error" variant="subtle" :description="t('team.notFound')" />
    <UAlert v-else-if="loadFailed" color="error" variant="subtle" :description="t('team.loadError')" />

    <div v-else-if="loading" class="text-muted flex justify-center py-8">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
    </div>

    <template v-else-if="overview">
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-semibold">{{ overview.team.name }}</h1>
        <UBadge :color="roleBadgeColor(overview.role)" variant="subtle">
          {{ t(`role.${overview.role}`) }}
        </UBadge>
      </div>

      <UCard>
        <template #header>
          <h2 class="font-medium">{{ t('team.membersTitle') }}</h2>
        </template>
        <ul class="divide-default divide-y">
          <li
            v-for="member in overview.members"
            :key="member.userId"
            class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <UAvatar :src="member.avatarUrl ?? undefined" :alt="member.name" size="sm" />
            <span class="min-w-0 flex-1 truncate">{{ member.name }}</span>
            <UBadge :color="roleBadgeColor(member.role)" variant="subtle">
              {{ t(`role.${member.role}`) }}
            </UBadge>
          </li>
        </ul>
      </UCard>

      <UCard v-if="inviteUrl">
        <template #header>
          <h2 class="font-medium">{{ t('team.inviteTitle') }}</h2>
        </template>
        <div class="space-y-3">
          <p class="text-muted text-sm">{{ t('team.inviteHint') }}</p>
          <div class="flex flex-wrap items-center gap-2">
            <UInput :model-value="inviteUrl" readonly class="grow" :ui="{ base: 'font-mono' }" />
            <UButton icon="i-lucide-copy" color="neutral" variant="subtle" @click="copyInvite">
              {{ t('team.copy') }}
            </UButton>
          </div>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="rotateOpen = true"
          >
            {{ t('team.rotate') }}
          </UButton>
        </div>
      </UCard>
    </template>

    <UModal
      v-model:open="rotateOpen"
      :title="t('team.rotateConfirmTitle')"
      :description="t('team.rotateConfirmText')"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton color="error" :loading="rotating" @click="rotate">
          {{ t('team.rotateConfirm') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
