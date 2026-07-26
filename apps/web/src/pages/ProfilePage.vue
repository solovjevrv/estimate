<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const session = useSessionStore();

const providerLabels: Record<string, string> = {
  google: 'Google',
  yandex: 'Яндекс',
};
</script>

<template>
  <UCard v-if="session.user" class="mx-auto max-w-md">
    <div class="flex flex-col items-center gap-3 text-center">
      <UAvatar :src="session.user.avatarUrl ?? undefined" :alt="session.user.name" size="xl" />
      <h1 class="text-lg font-semibold">{{ session.user.name }}</h1>
      <p class="text-muted text-sm">{{ session.user.email }}</p>
      <UBadge color="neutral" variant="subtle">
        {{ providerLabels[session.user.provider] ?? session.user.provider }}
      </UBadge>
    </div>
  </UCard>
  <p v-else class="text-muted text-center">{{ t('profile.notLoaded') }}</p>
</template>
