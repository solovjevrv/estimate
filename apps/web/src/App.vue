<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { LOCALES, rememberLocale, type Locale } from './i18n';
import { useSessionStore } from './stores/session';

const { t, locale } = useI18n();
const session = useSessionStore();
const router = useRouter();

const language = computed({
  get: () => locale.value as Locale,
  set: (next: Locale) => {
    locale.value = next;
    rememberLocale(next);
  },
});

onMounted(() => {
  void session.ensureLoaded();
});

/**
 * Без перехода страница остаётся как есть: гард роутера перепроверяет доступ
 * только при навигации, а не при смене состояния сессии на месте. На комнате
 * это заметнее всего — WS-сессия переживает logout, пока страницу не размонтируют.
 */
async function logout(): Promise<void> {
  await session.logout();
  await router.push('/');
}
</script>

<template>
  <UApp>
    <div class="min-h-screen flex flex-col bg-default text-default">
      <header class="border-b border-default">
        <nav class="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3">
          <RouterLink to="/" class="font-semibold">{{ t('app.name') }}</RouterLink>

          <RouterLink v-if="session.isAuthenticated" to="/teams" class="text-muted text-sm">
            {{ t('nav.teams') }}
          </RouterLink>

          <div class="ml-auto flex items-center gap-2">
            <USelect
              v-model="language"
              :items="[...LOCALES]"
              size="sm"
              :aria-label="t('nav.language')"
            />

            <UButton
              v-if="session.isAuthenticated"
              size="sm"
              color="neutral"
              variant="subtle"
              @click="logout"
            >
              {{ t('nav.logout') }}
            </UButton>
            <UButton v-else size="sm" to="/login">{{ t('nav.login') }}</UButton>
          </div>
        </nav>
      </header>

      <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <RouterView />
      </main>
    </div>
  </UApp>
</template>
