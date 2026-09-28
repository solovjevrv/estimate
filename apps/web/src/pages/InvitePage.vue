<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { ApiError } from '../lib/api';
import { teamAvatarColor } from '../lib/team-roles';
import { useSessionStore } from '../stores/session';
import { useTeamsStore } from '../stores/teams';

const props = defineProps<{ code: string }>();

const { t } = useI18n();
const router = useRouter();
const session = useSessionStore();
const teams = useTeamsStore();

const loading = ref(true);
const notFound = ref(false);
const loadFailed = ref(false);
const teamId = ref('');
const teamName = ref('');
const memberCount = ref(0);

const joining = ref(false);
const joinFailed = ref(false);

onMounted(async () => {
  try {
    const team = await teams.previewInvite(props.code);
    teamId.value = team.id;
    teamName.value = team.name;
    memberCount.value = team.memberCount;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true;
    } else {
      loadFailed.value = true;
    }
  } finally {
    loading.value = false;
  }
});

/**
 * Гостя сначала отправляем на вход, запомнив приглашение: после входа сработает
 * возврат на этот адрес (см. post-login), и он окажется здесь уже с сессией.
 * Вошедшего — вступляем и ведём в команду.
 */
async function act(): Promise<void> {
  if (!session.isAuthenticated) {
    await router.push({ name: 'login', query: { redirect: `/invite/${props.code}` } });
    return;
  }

  joining.value = true;
  joinFailed.value = false;
  try {
    const { team } = await teams.joinByInvite(props.code);
    await router.push({ name: 'team', params: { id: team.id } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true;
    } else {
      joinFailed.value = true;
    }
  } finally {
    joining.value = false;
  }
}
</script>

<template>
  <!-- 03_Auth «Invite»: карточка на 96px ниже шапки (56 — отступ main + 40), Card
       (elevation/3), паддинг 32, элементы через 16px -->
  <section class="mx-auto w-full max-w-[440px] space-y-6 md:mt-10">
    <div
      v-if="loading"
      class="surface-card shadow-elevation-3 space-y-4 rounded-r24 p-8 text-center"
    >
      <USkeleton class="mx-auto size-8 rounded-full" />
      <USkeleton class="mx-auto h-5 w-2/3 rounded-r12" />
      <USkeleton class="h-11 w-full rounded-r8" />
    </div>

    <UAlert
      v-else-if="notFound"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      :description="t('invite.notFound')"
    />
    <UAlert
      v-else-if="loadFailed"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      :description="t('invite.loadError')"
    />

    <div
      v-else
      class="surface-card shadow-elevation-3 flex flex-col gap-4 rounded-r24 p-8 text-center"
    >
      <div
        class="font-heading mx-auto flex size-[60px] items-center justify-center rounded-r20 text-xl font-bold"
        :class="teamAvatarColor(teamId)"
      >
        {{ teamName.slice(0, 1).toUpperCase() }}
      </div>
      <p class="text-text-primary text-lg leading-[26px] font-bold tracking-[-0.015em]">
        {{ t('invite.lead', { name: teamName }) }}
      </p>
      <div class="text-text-secondary flex items-center justify-center gap-2 text-sm font-medium">
        <UIcon name="i-lucide-users" class="size-4 shrink-0" />
        {{ t('teams.memberCount', { count: memberCount }, memberCount) }}
      </div>

      <UAlert
        v-if="joinFailed"
        icon="i-lucide-circle-alert"
        color="error"
        variant="subtle"
        class="text-left"
        :description="t('invite.joinError')"
      />

      <UButton block size="lg" :loading="joining" @click="act">
        <template v-if="joining">{{ t('invite.joining') }}</template>
        <template v-else-if="session.isAuthenticated">{{ t('invite.join') }}</template>
        <template v-else>{{ t('invite.joinAndLogin') }}</template>
      </UButton>
    </div>
  </section>
</template>
