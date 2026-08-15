/** Сессия пользователя: профиль из `/api/me` и список включённых способов входа. */
import type { AuthProvider, AuthUser } from '@poker/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { ApiError } from '../lib/api';
import {
  getCurrentUser,
  getAuthProviders,
  logoutCurrentUser,
  updateCurrentUser,
  uploadCurrentUserAvatar,
} from '../features/auth/api/auth-api';

export const useSessionStore = defineStore('session', () => {
  const user = ref<AuthUser | null>(null);
  const providers = ref<AuthProvider[]>([]);
  /** Пока профиль не запрошен, отличить гостя от неизвестности нельзя */
  const loaded = ref(false);

  /**
   * Профиль тянется один раз на загрузку страницы. Гард роутера ждёт именно эту
   * попытку: без общего промиса несколько переходов подряд дали бы несколько
   * запросов и разные ответы.
   */
  let pending: Promise<void> | null = null;

  const isAuthenticated = computed(() => user.value !== null);

  async function load(): Promise<void> {
    try {
      user.value = await getCurrentUser();
    } catch (err) {
      // 401 — обычный гость, а не сбой: сеть и прочие ошибки тоже оставляют
      // пользователя неавторизованным, приложение при этом работает
      if (!(err instanceof ApiError) || err.status !== 401) {
        console.warn('Не удалось получить профиль', err);
      }
      user.value = null;
    } finally {
      loaded.value = true;
    }
  }

  function ensureLoaded(): Promise<void> {
    if (loaded.value) return Promise.resolve();
    pending ??= load().finally(() => {
      pending = null;
    });
    return pending;
  }

  /** Список провайдеров задаётся ключами в окружении сервера, поэтому спрашиваем его */
  async function loadProviders(): Promise<void> {
    try {
      providers.value = await getAuthProviders();
    } catch (err) {
      console.warn('Не удалось получить список провайдеров', err);
      providers.value = [];
    }
  }

  /** Правка имени/должности со страницы профиля — оба поля одним запросом */
  async function updateProfile(fields: { name: string; jobTitle: string }): Promise<AuthUser> {
    user.value = await updateCurrentUser(fields);
    return user.value;
  }

  /** Загрузка своей аватарки (10.15) — blob уже вырезан кроппером на фронте */
  async function uploadAvatar(blob: Blob): Promise<AuthUser> {
    user.value = await uploadCurrentUserAvatar(blob);
    return user.value;
  }

  async function logout(): Promise<void> {
    try {
      await logoutCurrentUser();
    } finally {
      // Даже если запрос не дошёл, на клиенте пользователь считается вышедшим
      user.value = null;
    }
  }

  /** Только для тестов и колбэка входа: подставить профиль без запроса */
  function setUser(next: AuthUser | null): void {
    user.value = next;
    loaded.value = true;
  }

  return {
    user,
    providers,
    loaded,
    isAuthenticated,
    load,
    ensureLoaded,
    loadProviders,
    updateProfile,
    uploadAvatar,
    logout,
    setUser,
  };
});
