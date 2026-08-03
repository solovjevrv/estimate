<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import { computed, onMounted, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import ThemeSwitchTrack from './components/ThemeSwitchTrack.vue';
import { LOCALES, rememberLocale, type Locale } from './i18n';
import { initTheme, theme, toggleTheme } from './lib/theme';
import { useSessionStore } from './stores/session';

const { t, locale } = useI18n();
const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const teamsLinkActive = computed(() => route.path.startsWith('/teams'));
const myRoomsLinkActive = computed(() => route.path.startsWith('/my-rooms'));

const language = computed({
  get: () => locale.value as Locale,
  set: (next: Locale) => {
    locale.value = next;
    rememberLocale(next);
  },
});

const isDark = computed(() => theme.value === 'dark');

const currentYear = new Date().getFullYear();
const supportEmail = 'solovjevrv@gmail.com';
const appVersion = __APP_VERSION__;

// Заголовок вкладки и lang зависят и от роута, и от языка — считаем вместе,
// иначе смена языка без навигации оставила бы заголовок на старом языке
watchEffect(() => {
  document.title = `EstiMate | ${t(route.meta.titleKey ?? 'nav.home')}`;
  document.documentElement.lang = locale.value;
});

const languageLabels: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
};

// preventDefault в onSelect держит меню открытым: иначе Reka UI закрывает его
// после любого выбора, включая чекбоксы, и переключить тему/язык дважды подряд
// можно было бы только через повторное открытие меню
function keepMenuOpen(e: Event): void {
  e.preventDefault();
}

const languageMenuItems = computed<DropdownMenuItem[]>(() =>
  LOCALES.map((loc) => ({
    label: languageLabels[loc],
    type: 'checkbox',
    checked: language.value === loc,
    onUpdateChecked: (checked: boolean) => {
      if (checked) language.value = loc;
    },
    onSelect: keepMenuOpen,
  })),
);

const userMenuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: t('nav.themeLabel'),
      icon: 'i-lucide-moon',
      slot: 'theme',
      onSelect: (e: Event) => {
        e.preventDefault();
        toggleTheme();
      },
    },
    { label: t('nav.language'), icon: 'i-lucide-languages', children: languageMenuItems.value },
  ],
  [{ label: t('nav.profile'), icon: 'i-lucide-user', to: '/profile' }],
  [{ label: t('nav.logout'), icon: 'i-lucide-log-out', onSelect: () => void logout() }],
]);

onMounted(() => {
  void session.ensureLoaded();
  initTheme();
});

/**
 * Без перехода страница остаётся как есть: гард роутера перепроверяет доступ
 * только при навигации, а не при смене состояния сессии на месте. На комнате
 * это заметнее всего — WS-сессия переживает logout, пока страницу не размонтируют.
 */
async function logout(): Promise<void> {
  try {
    await session.logout();
  } catch {
    // Запрос на сервер не дошёл — session.logout() и так очистил пользователя
    // на клиенте, значит со страницы всё равно надо уйти
  } finally {
    await router.push('/');
  }
}
</script>

<template>
  <UApp>
    <div class="min-h-screen flex flex-col bg-default text-highlighted">
      <header class="border-default border-b" style="background-color: var(--brand-surface)">
        <nav class="mx-auto flex h-[76px] w-full max-w-[73.75rem] items-center gap-8 px-14">
          <RouterLink to="/" class="flex items-center gap-2">
            <span class="relative inline-block size-[30px]" aria-hidden="true">
              <span
                class="absolute top-[2px] left-[6px] h-[22px] w-4 rounded"
                style="background: var(--brand-amber); transform: rotate(-8deg)"
              />
              <span
                class="bg-primary absolute top-[2px] left-0 h-[22px] w-4 rounded"
                style="transform: rotate(8deg)"
              />
            </span>
            <span class="font-heading text-[19px] font-extrabold tracking-tight">{{
              t('app.name')
            }}</span>
          </RouterLink>

          <RouterLink
            v-if="session.isAuthenticated"
            to="/teams"
            class="text-[15px] font-semibold"
            :class="teamsLinkActive ? 'text-primary' : 'text-muted'"
          >
            {{ t('nav.teams') }}
          </RouterLink>
          <RouterLink
            v-if="session.isAuthenticated"
            to="/my-rooms"
            class="text-[15px] font-semibold"
            :class="myRoomsLinkActive ? 'text-primary' : 'text-muted'"
          >
            {{ t('nav.myRooms') }}
          </RouterLink>

          <div class="ml-auto flex items-center gap-2">
            <template v-if="!session.isAuthenticated">
              <USelect
                v-model="language"
                :items="[...LOCALES]"
                size="sm"
                :aria-label="t('nav.language')"
              />

              <UTooltip :text="t(isDark ? 'nav.theme.light' : 'nav.theme.dark')">
                <UButton
                  :icon="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
                  size="sm"
                  color="neutral"
                  variant="subtle"
                  :aria-label="t(isDark ? 'nav.theme.light' : 'nav.theme.dark')"
                  @click="toggleTheme"
                />
              </UTooltip>
            </template>

            <UDropdownMenu v-if="session.isAuthenticated" :items="userMenuItems">
              <template #theme-trailing>
                <ThemeSwitchTrack :is-dark="isDark" />
              </template>
              <button
                type="button"
                class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1"
                :aria-label="t('nav.userMenu')"
              >
                <span class="flex flex-col items-end leading-tight">
                  <span class="text-sm font-bold">{{ session.user?.name }}</span>
                  <span class="text-primary text-[13px] font-semibold">{{
                    session.user?.jobTitle ?? session.user?.email
                  }}</span>
                </span>
                <UAvatar
                  :src="session.user?.avatarUrl ?? undefined"
                  :alt="session.user?.name"
                  size="md"
                  class="size-[38px]"
                />
                <UIcon name="i-lucide-chevron-down" class="text-muted size-4" />
              </button>
            </UDropdownMenu>
            <UButton v-else size="sm" to="/login">{{ t('nav.login') }}</UButton>
          </div>
        </nav>
      </header>

      <main class="mx-auto w-full max-w-[73.75rem] flex-1 px-4 py-14">
        <RouterView />
      </main>

      <footer class="border-default border-t" style="background-color: var(--brand-surface)">
        <div
          class="text-muted mx-auto flex w-full max-w-[73.75rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-[13px]"
        >
          <span>{{ t('footer.copyright', { year: currentYear }) }}</span>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
            <a :href="`mailto:${supportEmail}`" class="hover:text-highlighted">{{
              t('footer.support')
            }}</a>
            <a
              href="https://github.com/solovjevrv/poker-planing/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-highlighted"
              >{{ t('footer.license') }}</a
            >
            <a
              href="https://github.com/solovjevrv/poker-planing"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-highlighted"
              >GitHub</a
            >
            <span>{{ t('footer.build', { version: appVersion }) }}</span>
          </div>
        </div>
      </footer>
    </div>
  </UApp>
</template>
