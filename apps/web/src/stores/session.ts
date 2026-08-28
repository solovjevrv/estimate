/** Сессия пользователя: профиль из `/api/me` и список включённых способов входа. */
import type { AuthProvider, AuthUser } from '@estimate/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { ApiError, api } from '../lib/api';

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
      const { user: profile } = await api.get<{ user: AuthUser }>('/api/me');
      user.value = profile;
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
      const res = await api.get<{ providers: AuthProvider[] }>('/api/auth/providers');
      providers.value = res.providers;
    } catch (err) {
      console.warn('Не удалось получить список провайдеров', err);
      providers.value = [];
    }
  }

  /** Правка имени/должности со страницы профиля — оба поля одним запросом */
  async function updateProfile(fields: { name: string; jobTitle: string }): Promise<AuthUser> {
    const res = await api.patch<{ user: AuthUser }>('/api/me', fields);
    user.value = res.user;
    return res.user;
  }

  /** Загрузка своей аватарки (10.15) — blob уже вырезан кроппером на фронте */
  async function uploadAvatar(blob: Blob): Promise<AuthUser> {
    const body = new FormData();
    body.append('avatar', blob, 'avatar.webp');
    const res = await api.upload<{ user: AuthUser }>('/api/me/avatar', body);
    user.value = res.user;
    return res.user;
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout');
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
