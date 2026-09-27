<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import { computed, onMounted, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import ThemeSwitchTrack from './components/ThemeSwitchTrack.vue';
import { LOCALES, rememberLocale, type Locale } from './i18n';
import { teamAvatarColor } from './lib/team-roles';
import { initTheme, theme, toggleTheme } from './lib/theme';
import { useSessionStore } from './stores/session';

const { t, locale } = useI18n();
const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const teamsLinkActive = computed(() => route.path.startsWith('/teams'));
const myRoomsLinkActive = computed(() => route.path.startsWith('/my-rooms'));
const boardsLinkActive = computed(() => route.path.startsWith('/boards'));

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

const mobileNavItems = computed<DropdownMenuItem[]>(() => [
  { label: t('nav.teams'), icon: 'i-lucide-users', to: '/teams' },
  { label: t('nav.myRooms'), icon: 'i-lucide-layout-grid', to: '/my-rooms' },
  { label: t('nav.boards'), icon: 'i-lucide-layout-dashboard', to: '/boards' },
]);

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
    <div
      class="flex flex-col bg-[var(--page-bg)] text-highlighted"
      :class="route.meta.fullBleedCanvas ? 'h-screen overflow-hidden' : 'min-h-screen'"
    >
      <header class="border-default border-b" style="background-color: var(--brand-surface)">
        <nav
          class="mx-auto flex h-[64px] w-full max-w-[73.75rem] items-center gap-3 px-4 sm:gap-6 sm:px-6 md:h-[76px] md:gap-8 md:px-14"
        >
          <RouterLink to="/" class="flex shrink-0 items-center gap-2">
            <!-- Логомарк — вектор из Header кита (62_Header, Real Logo): зелёный — примитив
                 brand/100 (одинаковый в обеих темах), оранжевый в ките без токена -->
            <svg
              width="31"
              height="27"
              viewBox="0 0 31 27"
              fill="none"
              aria-hidden="true"
              class="shrink-0"
            >
              <path
                d="M9.49225 6.76497C9.12927 4.18197 10.9289 1.79376 13.5119 1.43077L22.8656 0.1162C25.4486 -0.246853 27.8368 1.55283 28.1998 4.13576L30.4534 20.1709C30.8164 22.7538 29.0168 25.142 26.4338 25.5051L17.0801 26.8196C14.4971 27.1826 12.1089 25.383 11.7459 22.8L9.49225 6.76497Z"
                fill="#FF8C00"
              />
              <path
                d="M2.30016 4.06617C2.66314 1.48317 5.05136 -0.316441 7.63436 0.0465443L16.9881 1.36112C19.5711 1.72417 21.3707 4.11238 21.0077 6.69532L18.7541 22.7304C18.3911 25.3134 16.0029 27.113 13.4199 26.75L4.06617 25.4354C1.48317 25.0724 -0.316441 22.6842 0.0465443 20.1012L2.30016 4.06617Z"
                fill="var(--palette-brand-100)"
              />
            </svg>
            <span class="font-heading text-text-primary text-xl font-bold tracking-[-0.02em]">{{
              t('app.name')
            }}</span>
          </RouterLink>

          <UDropdownMenu v-if="session.isAuthenticated" :items="mobileNavItems" class="md:hidden">
            <UButton
              icon="i-lucide-menu"
              size="sm"
              color="neutral"
              variant="ghost"
              :aria-label="t('nav.menu')"
            />
          </UDropdownMenu>

          <RouterLink
            v-if="session.isAuthenticated"
            to="/teams"
            class="hidden text-sm font-bold tracking-[-0.01em] md:inline"
            :class="teamsLinkActive ? 'text-text-brand' : 'text-text-secondary'"
          >
            {{ t('nav.teams') }}
          </RouterLink>
          <RouterLink
            v-if="session.isAuthenticated"
            to="/my-rooms"
            class="hidden text-sm font-bold tracking-[-0.01em] md:inline"
            :class="myRoomsLinkActive ? 'text-text-brand' : 'text-text-secondary'"
          >
            {{ t('nav.myRooms') }}
          </RouterLink>
          <RouterLink
            v-if="session.isAuthenticated"
            to="/boards"
            class="hidden text-sm font-bold tracking-[-0.01em] md:inline"
            :class="boardsLinkActive ? 'text-text-brand' : 'text-text-secondary'"
          >
            {{ t('nav.boards') }}
          </RouterLink>

          <div class="ml-auto flex items-center gap-2">
            <template v-if="!session.isAuthenticated">
              <UTooltip :text="t(isDark ? 'nav.theme.light' : 'nav.theme.dark')">
                <!-- Header Guest: Theme toggle — Button Primary/Outline/Md, icon-only 44×40 -->
                <UButton
                  :icon="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
                  size="md"
                  color="primary"
                  variant="outline"
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
                class="flex cursor-pointer items-center gap-2 rounded-r10 px-2 py-1"
                :aria-label="t('nav.userMenu')"
              >
                <span class="hidden flex-col items-end leading-tight sm:flex">
                  <span class="text-text-primary text-sm font-bold">{{ session.user?.name }}</span>
                  <span class="text-text-secondary text-xs font-medium">{{
                    session.user?.jobTitle ?? session.user?.email
                  }}</span>
                </span>
                <UAvatar
                  :src="session.user?.avatarUrl ?? undefined"
                  :alt="session.user?.name"
                  size="md"
                  class="size-10"
                  :class="teamAvatarColor(session.user?.id ?? '')"
                  :ui="{ fallback: 'text-[15px]' }"
                />
                <UIcon name="i-lucide-chevron-down" class="text-icons-secondary size-4" />
              </button>
            </UDropdownMenu>
            <UButton v-else size="md" to="/login">{{ t('nav.login') }}</UButton>
          </div>
        </nav>
      </header>

      <main
        class="w-full flex-1"
        :class="
          route.meta.fullBleedCanvas
            ? 'flex min-h-0 flex-col overflow-hidden'
            : 'mx-auto max-w-[73.75rem] px-4 py-8 md:py-14'
        "
      >
        <RouterView />
      </main>

      <footer
        v-if="!route.meta.fullBleedCanvas"
        class="border-default border-t"
        style="background-color: var(--brand-surface)"
      >
        <div
          class="text-muted mx-auto flex w-full max-w-[73.75rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-[13px]"
        >
          <span>{{ t('footer.copyright', { year: currentYear }) }}</span>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
            <a :href="`mailto:${supportEmail}`" class="hover:text-highlighted">{{
              t('footer.support')
            }}</a>
            <span>{{ t('footer.build', { version: appVersion }) }}</span>
          </div>
        </div>
      </footer>
    </div>
  </UApp>
</template>
