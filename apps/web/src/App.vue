<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';

import { LOCALES, rememberLocale, type Locale } from './i18n';
import { useSessionStore } from './stores/session';

const { t, locale } = useI18n();
const session = useSessionStore();

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
              @click="session.logout()"
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
