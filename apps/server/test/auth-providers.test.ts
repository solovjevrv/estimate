import { afterEach, describe, expect, it, vi } from 'vitest';

import { PROVIDER_DEFINITIONS } from '../src/auth';

function mockFetch(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ ok, status, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('профили OAuth-провайдеров', () => {
  it('Google: приводит userinfo к единому виду', async () => {
    const fetchMock = mockFetch({
      sub: '1234567890',
      email: 'user@gmail.com',
      name: 'Иван Иванов',
      picture: 'https://lh3.googleusercontent.com/a/photo',
    });

    const profile = await PROVIDER_DEFINITIONS.google.fetchProfile('token-abc');

    expect(profile).toEqual({
      providerId: '1234567890',
      email: 'user@gmail.com',
      name: 'Иван Иванов',
      avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.authorization).toBe('Bearer token-abc');
  });

  it('Google: без имени подставляет email, без картинки — null', async () => {
    mockFetch({ sub: '42', email: 'user@gmail.com' });

    const profile = await PROVIDER_DEFINITIONS.google.fetchProfile('token');

    expect(profile.name).toBe('user@gmail.com');
    expect(profile.avatarUrl).toBeNull();
  });

  it('Яндекс: собирает ссылку на аватар из default_avatar_id', async () => {
    const fetchMock = mockFetch({
      id: '987',
      default_email: 'user@yandex.ru',
      real_name: 'Пётр Петров',
      default_avatar_id: 'avatar-id',
      is_avatar_empty: false,
    });

    const profile = await PROVIDER_DEFINITIONS.yandex.fetchProfile('token-xyz');

    expect(profile).toEqual({
      providerId: '987',
      email: 'user@yandex.ru',
      name: 'Пётр Петров',
      avatarUrl: 'https://avatars.yandex.net/get-yapic/avatar-id/islands-200',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.authorization).toBe('OAuth token-xyz');
  });

  it('Яндекс: пустой аватар не превращается в ссылку', async () => {
    mockFetch({
      id: '987',
      default_email: 'user@yandex.ru',
      display_name: 'Пётр',
      default_avatar_id: 'placeholder',
      is_avatar_empty: true,
    });

    const profile = await PROVIDER_DEFINITIONS.yandex.fetchProfile('token');

    expect(profile.avatarUrl).toBeNull();
    expect(profile.name).toBe('Пётр');
  });

  it('ошибка провайдера превращается в исключение', async () => {
    mockFetch({}, false, 401);

    await expect(PROVIDER_DEFINITIONS.google.fetchProfile('bad')).rejects.toThrow(/401/);
  });

  it('профиль без обязательных полей отклоняется', async () => {
    mockFetch({ sub: '1' });

    await expect(PROVIDER_DEFINITIONS.google.fetchProfile('token')).rejects.toThrow(/email/);
  });
});
