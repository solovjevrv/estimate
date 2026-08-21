import type { AuthProvider, AuthUser } from '@poker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCurrentUser,
  getAuthProviders,
  getProviderLoginUrl,
  logoutCurrentUser,
  updateCurrentUser,
  uploadCurrentUserAvatar,
} from '../src/features/auth/api/auth-api';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const user: AuthUser = {
  id: 'u1',
  name: 'Иван',
  email: 'ivan@example.com',
  avatarUrl: null,
  provider: 'google',
  jobTitle: 'Dev',
};

describe('API авторизации', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getCurrentUser возвращает профиль из /api/me', async () => {
    fetchMock.mockResolvedValue(json(200, { user }));
    const res = await getCurrentUser();
    expect(res).toEqual(user);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/me');
  });

  it('getAuthProviders возвращает список провайдеров', async () => {
    const providers: AuthProvider[] = ['google', 'yandex'];
    fetchMock.mockResolvedValue(json(200, { providers }));
    const res = await getAuthProviders();
    expect(res).toEqual(providers);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/providers');
  });

  it('updateCurrentUser отправляет имя и должность (PATCH /api/me)', async () => {
    fetchMock.mockResolvedValue(json(200, { user }));
    const res = await updateCurrentUser({ name: 'Пётр', jobTitle: 'Lead' });
    expect(res).toEqual(user);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/me');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Пётр', jobTitle: 'Lead' });
  });

  it('uploadCurrentUserAvatar отправляет FormData с avatar (POST /api/me/avatar)', async () => {
    fetchMock.mockResolvedValue(json(200, { user }));
    const blob = new Blob(['x'], { type: 'image/webp' });
    const res = await uploadCurrentUserAvatar(blob);
    expect(res).toEqual(user);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/me/avatar');
    expect(init.method).toBe('POST');
    const fd = init.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get('avatar')).toBeInstanceOf(Blob);
  });

  it('logoutCurrentUser отправляет POST /api/auth/logout', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await logoutCurrentUser();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/logout');
    expect(init.method).toBe('POST');
  });
});

describe('getProviderLoginUrl', () => {
  it('строит URL перехода к провайдеру', () => {
    expect(getProviderLoginUrl('google')).toBe('/api/auth/google');
    expect(getProviderLoginUrl('yandex')).toBe('/api/auth/yandex');
  });

  it('кодирует id провайдера в сегменте пути', () => {
    expect(getProviderLoginUrl('a/b' as AuthProvider)).toBe('/api/auth/a%2Fb');
  });
});
