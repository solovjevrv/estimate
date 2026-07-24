<script setup lang="ts">
import type { AuthProvider } from '@poker/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { rememberRedirect } from '../lib/auth-redirect';
import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const session = useSessionStore();

/**
 * Сервер вернул сюда с ?error=oauth, если обмен кода на токен не удался или
 * пользователь отменил вход на экране провайдера. Снимаем признак сразу в
 * локальное состояние — ниже чистим сам адрес, а сообщение должно остаться.
 */
const failed = ref(route.query.error === 'oauth');

/** Пока браузер уходит к провайдеру, показываем прогресс на нажатой кнопке */
const pending = ref<AuthProvider | null>(null);

const labels: Record<AuthProvider, string> = {
  google: 'login.withGoogle',
  yandex: 'login.withYandex',
};

/** Куда вернуть пользователя после входа: гард положил сюда исходный приватный адрес */
const redirectTarget = computed(() =>
  typeof route.query.redirect === 'string' ? route.query.redirect : null,
);

/**
 * Вход — это переход браузера на сервер, а не запрос из приложения: провайдер
 * должен показать свой экран согласия и вернуть пользователя обратно с кукой.
 */
function startUrl(provider: AuthProvider): string {
  return `/api/auth/${provider}`;
}

/**
 * Перед уходом к провайдеру запоминаем цель перехода и помечаем кнопку.
 *
 * Переход на сервер инициируем сами, а не полагаемся на клик по ссылке: Nuxt UI
 * в состоянии loading помечает кнопку disabled и убирает у неё href, поэтому
 * штатная навигация по ссылке в этот момент уже не сработала бы.
 */
function start(provider: AuthProvider): void {
  rememberRedirect(redirectTarget.value);
  pending.value = provider;
  window.location.assign(startUrl(provider));
}

onMounted(() => {
  void session.loadProviders();
  // Ошибку уже забрали в локальное состояние — убираем её из адреса, чтобы
  // перезагрузка страницы не показывала сообщение снова.
  if (route.query.error) {
    const query = { ...route.query };
    delete query.error;
    void router.replace({ query });
  }
});
</script>

<template>
  <UCard class="mx-auto max-w-sm">
    <template #header>
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">{{ t('login.title') }}</h1>
        <p class="text-muted text-sm">{{ t('login.lead') }}</p>
      </div>
    </template>

    <div class="space-y-4">
      <UAlert v-if="failed" color="error" variant="subtle" :description="t('login.failed')" />

      <div class="space-y-3">
        <UButton
          v-for="provider in session.providers"
          :key="provider"
          :href="startUrl(provider)"
          external
          :loading="pending === provider"
          :disabled="pending !== null"
          block
          color="neutral"
          variant="subtle"
          @click="start(provider)"
        >
          {{ pending === provider ? t('login.redirecting') : t(labels[provider]) }}
        </UButton>

        <p v-if="session.providers.length === 0" class="text-muted text-sm">
          {{ t('login.noProviders') }}
        </p>
      </div>
    </div>
  </UCard>
</template>
