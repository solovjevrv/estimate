<script setup lang="ts">
import type { AuthProvider } from '@poker/shared';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const route = useRoute();
const session = useSessionStore();

/** Сервер возвращает сюда с `?error=oauth`, если обмен кода на токен не удался */
const failed = computed(() => route.query.error === 'oauth');

const labels: Record<AuthProvider, string> = {
  google: 'login.withGoogle',
  yandex: 'login.withYandex',
};

/**
 * Вход — это переход браузера на сервер, а не запрос из приложения: провайдер
 * должен показать свой экран согласия и вернуть пользователя обратно с кукой.
 */
function startUrl(provider: AuthProvider): string {
  return `/api/auth/${provider}`;
}

onMounted(() => {
  void session.loadProviders();
});
</script>

<template>
  <section class="mx-auto max-w-sm space-y-6">
    <div class="space-y-2">
      <h1 class="text-2xl font-semibold">{{ t('login.title') }}</h1>
      <p class="text-muted">{{ t('login.lead') }}</p>
    </div>

    <UAlert v-if="failed" color="error" variant="subtle" :description="t('login.failed')" />

    <div class="space-y-3">
      <UButton
        v-for="provider in session.providers"
        :key="provider"
        :href="startUrl(provider)"
        block
        color="neutral"
        variant="subtle"
      >
        {{ t(labels[provider]) }}
      </UButton>

      <p v-if="session.providers.length === 0" class="text-muted text-sm">
        {{ t('login.noProviders') }}
      </p>
    </div>
  </section>
</template>
