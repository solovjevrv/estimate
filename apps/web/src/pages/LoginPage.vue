<script setup lang="ts">
import type { AuthProvider } from '@estimate/shared';
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
  <div class="mx-auto flex max-w-sm justify-center py-16">
    <div class="surface-card surface-card-lg w-full px-[30px] py-[34px]">
      <div class="mb-6 text-center">
        <h1 class="font-heading text-2xl font-extrabold">{{ t('login.title') }}</h1>
        <p class="text-muted mt-2 text-sm">{{ t('login.lead') }}</p>
      </div>

      <UAlert
        v-if="failed"
        color="error"
        variant="subtle"
        class="mb-4"
        :description="t('login.failed')"
      />

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
          variant="outline"
          class="rounded-[11px] py-3 text-[15px] font-bold"
          @click="start(provider)"
        >
          {{ pending === provider ? t('login.redirecting') : t(labels[provider]) }}
        </UButton>

        <p v-if="session.providers.length === 0" class="text-muted text-sm">
          {{ t('login.noProviders') }}
        </p>
      </div>
    </div>
  </div>
</template>
