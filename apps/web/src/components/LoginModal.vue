<script setup lang="ts">
import type { AuthProvider } from '@estimate/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { getProviderLoginUrl } from '../features/auth/api/auth-api';
import { rememberRedirect } from '../lib/auth-redirect';
import { loginModal } from '../lib/login-modal';
import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const onLoginRoute = computed(() => route.name === 'login');

/**
 * Открыто, если пришли на /login (гард приватной страницы, возврат после ошибки
 * OAuth) или окно вызвали кнопкой «Войти». Закрытие на /login уводит на главную —
 * под окном и так главная, а сам адрес входа без окна смысла не имеет.
 */
const open = computed({
  get: () => onLoginRoute.value || loginModal.open,
  set: (value: boolean) => {
    if (value) return;
    loginModal.open = false;
    if (onLoginRoute.value) void router.replace({ name: 'home' });
  },
});

/** Окно, открытое кнопкой, не переживает переход на другую страницу */
watch(
  () => route.fullPath,
  () => {
    loginModal.open = false;
  },
);

/** Куда вернуть пользователя после входа: с /login — из адреса (его кладёт гард) */
const redirectTarget = computed(() => {
  if (onLoginRoute.value) {
    return typeof route.query.redirect === 'string' ? route.query.redirect : null;
  }
  return loginModal.redirect;
});

/**
 * Сервер вернул на /login?error=oauth, если обмен кода на токен не удался или
 * пользователь отменил вход на экране провайдера. Признак забираем в локальное
 * состояние и чистим адрес, чтобы перезагрузка не показала сообщение снова.
 */
const failed = ref(false);
watch(
  () => [route.name, route.query.error] as const,
  ([name, error]) => {
    if (name !== 'login' || !error) return;
    failed.value = error === 'oauth';
    const query = { ...route.query };
    delete query.error;
    void router.replace({ query });
  },
  { immediate: true },
);

/** Пока браузер уходит к провайдеру, показываем прогресс на нажатой кнопке */
const pending = ref<AuthProvider | null>(null);

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      void session.loadProviders();
    } else {
      failed.value = false;
      pending.value = null;
    }
  },
  { immediate: true },
);

const labels: Record<AuthProvider, string> = {
  google: 'login.withGoogle',
  yandex: 'login.withYandex',
};

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
  window.location.assign(getProviderLoginUrl(provider));
}
</script>

<template>
  <!-- 27_Modal «Login dialog»: Header → Body 16, внутри Body (алерт, кнопки) — 12 -->
  <!-- Автофокус выключен: иначе фокус (и его рамка) при открытии падает на крестик —
       единственный интерактив до кнопок провайдеров; Tab всё равно ведёт внутрь окна -->
  <UModal
    v-model:open="open"
    :title="t('login.title')"
    :description="t('login.lead')"
    :content="{ onOpenAutoFocus: (e: Event) => e.preventDefault() }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UAlert
          v-if="failed"
          icon="i-lucide-circle-alert"
          color="error"
          variant="subtle"
          :description="t('login.failed')"
        />
        <UButton
          v-for="provider in session.providers"
          :key="provider"
          :href="getProviderLoginUrl(provider)"
          external
          :loading="pending === provider"
          :disabled="pending !== null"
          block
          size="lg"
          color="neutral"
          variant="outline"
          @click="start(provider)"
        >
          <template #leading>
            <UIcon v-if="provider === 'google'" name="i-logos-google-icon" class="size-6" />
            <span
              v-else
              class="flex size-6 items-center justify-center rounded-full bg-[#fc3f1d] text-[13px] font-extrabold text-white"
            >
              Я
            </span>
          </template>
          {{ pending === provider ? t('login.redirecting') : t(labels[provider]) }}
        </UButton>

        <UAlert
          v-if="session.providers.length === 0"
          icon="i-lucide-circle-alert"
          color="error"
          variant="subtle"
          :description="t('login.noProviders')"
        />
      </div>
    </template>
  </UModal>
</template>
