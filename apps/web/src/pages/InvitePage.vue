<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { ApiError } from '../lib/api';
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
const teamName = ref('');

const joining = ref(false);
const joinFailed = ref(false);

onMounted(async () => {
  try {
    const team = await teams.previewInvite(props.code);
    teamName.value = team.name;
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
  <section class="mx-auto max-w-md space-y-6">
    <div v-if="loading" class="text-muted flex justify-center py-8">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
    </div>

    <UAlert
      v-else-if="notFound"
      color="error"
      variant="subtle"
      :description="t('invite.notFound')"
    />
    <UAlert
      v-else-if="loadFailed"
      color="error"
      variant="subtle"
      :description="t('invite.loadError')"
    />

    <UCard v-else>
      <div class="space-y-4 text-center">
        <UIcon name="i-lucide-users" class="text-primary mx-auto size-8" />
        <p class="text-lg">{{ t('invite.lead', { name: teamName }) }}</p>

        <UAlert
          v-if="joinFailed"
          color="error"
          variant="subtle"
          :description="t('invite.joinError')"
        />

        <UButton block :loading="joining" @click="act">
          <template v-if="joining">{{ t('invite.joining') }}</template>
          <template v-else-if="session.isAuthenticated">{{ t('invite.join') }}</template>
          <template v-else>{{ t('invite.joinAndLogin') }}</template>
        </UButton>
      </div>
    </UCard>
  </section>
</template>
