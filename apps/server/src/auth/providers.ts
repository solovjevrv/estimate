import fastifyOauth2, { type ProviderConfiguration } from '@fastify/oauth2';
import type { AuthProvider } from '@poker/shared';

/** Профиль, приведённый к единому виду независимо от провайдера */
export interface OAuthProfile {
  providerId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface ProviderDefinition {
  /** Эндпоинты провайдера для @fastify/oauth2 */
  configuration: ProviderConfiguration;
  scope: string[];
  /** Запрос профиля по выданному access-токену */
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

const PROFILE_TIMEOUT_MS = 5_000;

async function fetchJson(
  provider: AuthProvider,
  url: string,
  authorization: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { authorization, accept: 'application/json' },
    signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Провайдер ${provider} вернул ${res.status} на запрос профиля`);
  }
  return (await res.json()) as Record<string, unknown>;
}

function requireString(
  provider: AuthProvider,
  data: Record<string, unknown>,
  field: string,
): string {
  const value = data[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`В профиле ${provider} нет обязательного поля "${field}"`);
  }
  return value;
}

function optionalString(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Ссылку на аватар показываем в UI, поэтому принимаем только https */
function safeAvatarUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export const PROVIDER_DEFINITIONS: Record<AuthProvider, ProviderDefinition> = {
  google: {
    configuration: fastifyOauth2.GOOGLE_CONFIGURATION,
    scope: ['openid', 'email', 'profile'],
    async fetchProfile(accessToken) {
      const data = await fetchJson(
        'google',
        'https://openidconnect.googleapis.com/v1/userinfo',
        `Bearer ${accessToken}`,
      );
      const email = requireString('google', data, 'email');
      // Неподтверждённой почте доверять нельзя: дальше по ней зовут в команды
      if (data.email_verified !== true) {
        throw new Error('Google: email не подтверждён');
      }
      return {
        providerId: requireString('google', data, 'sub'),
        email,
        name: optionalString(data, 'name') ?? email,
        avatarUrl: safeAvatarUrl(optionalString(data, 'picture')),
      };
    },
  },
  yandex: {
    configuration: fastifyOauth2.YANDEX_CONFIGURATION,
    scope: ['login:email', 'login:info', 'login:avatar'],
    async fetchProfile(accessToken) {
      const data = await fetchJson(
        'yandex',
        'https://login.yandex.ru/info?format=json',
        `OAuth ${accessToken}`,
      );
      const email = requireString('yandex', data, 'default_email');
      const avatarId = optionalString(data, 'default_avatar_id');
      return {
        providerId: requireString('yandex', data, 'id'),
        email,
        name: optionalString(data, 'real_name') ?? optionalString(data, 'display_name') ?? email,
        avatarUrl:
          avatarId && data.is_avatar_empty !== true
            ? `https://avatars.yandex.net/get-yapic/${encodeURIComponent(avatarId)}/islands-200`
            : null,
      };
    },
  },
};
