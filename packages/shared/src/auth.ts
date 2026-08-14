/** Общие типы и контракты, используемые фронтендом и бэкендом. */

/** OAuth-провайдеры, через которых можно войти */
export type AuthProvider = 'google' | 'yandex';

export const AUTH_PROVIDERS: readonly AuthProvider[] = ['google', 'yandex'];

/** Публичный профиль авторизованного пользователя (отдаётся фронту) */
export interface AuthUser {
  id: string;
  provider: AuthProvider;
  email: string;
  name: string;
  jobTitle: string | null;
  avatarUrl: string | null;
}

/** Ограничения полей профиля, редактируемых пользователем (задача 9.2) */
export const USER_NAME_MAX_LENGTH = 60;
export const USER_JOB_TITLE_MAX_LENGTH = 100;
