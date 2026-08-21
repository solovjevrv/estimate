/** REST-слой сессии/авторизации: единственное место, знающее URL `/api/me`, `/api/auth` и FormData. */
import type { AuthProvider, AuthUser } from '@poker/shared';
import { api } from '../../../lib/api';

export function getCurrentUser(): Promise<AuthUser> {
  return api.get<{ user: AuthUser }>('/api/me').then((res) => res.user);
}

export function getAuthProviders(): Promise<AuthProvider[]> {
  return api.get<{ providers: AuthProvider[] }>('/api/auth/providers').then((res) => res.providers);
}

export function updateCurrentUser(fields: { name: string; jobTitle: string }): Promise<AuthUser> {
  return api.patch<{ user: AuthUser }>('/api/me', fields).then((res) => res.user);
}

/** Загрузка своей аватарки (10.15) — blob уже вырезан кроппером на фронте */
export function uploadCurrentUserAvatar(blob: Blob): Promise<AuthUser> {
  const body = new FormData();
  body.append('avatar', blob, 'avatar.webp');
  return api.upload<{ user: AuthUser }>('/api/me/avatar', body).then((res) => res.user);
}

export function logoutCurrentUser(): Promise<void> {
  return api.post('/api/auth/logout');
}

/** URL перехода браузера к OAuth-провайдеру — обычная навигация, не fetch */
export function getProviderLoginUrl(provider: AuthProvider): string {
  return `/api/auth/${encodeURIComponent(provider)}`;
}
