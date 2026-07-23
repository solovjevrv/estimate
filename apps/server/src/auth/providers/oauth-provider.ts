import type { ProviderConfiguration } from '@fastify/oauth2';
import type { AuthProvider } from '@poker/shared';

/** Профиль, приведённый к единому виду независимо от провайдера */
export interface OAuthProfile {
  providerId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

const PROFILE_TIMEOUT_MS = 5_000;

/** Общая часть работы с OAuth-провайдером: конкретные наследники знают только свой формат профиля */
export abstract class OAuthProvider {
  abstract readonly name: AuthProvider;
  /** Эндпоинты провайдера для @fastify/oauth2 */
  abstract readonly configuration: ProviderConfiguration;
  abstract readonly scope: string[];

  /** Запрос профиля по выданному access-токену */
  abstract fetchProfile(accessToken: string): Promise<OAuthProfile>;

  protected async fetchJson(url: string, authorization: string): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      headers: { authorization, accept: 'application/json' },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Провайдер ${this.name} вернул ${res.status} на запрос профиля`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  protected requireString(data: Record<string, unknown>, field: string): string {
    const value = data[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`В профиле ${this.name} нет обязательного поля "${field}"`);
    }
    return value;
  }

  protected optionalString(data: Record<string, unknown>, field: string): string | undefined {
    const value = data[field];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  /** Ссылку на аватар показываем в UI, поэтому принимаем только https */
  protected safeAvatarUrl(value: string | undefined): string | null {
    if (!value) return null;
    try {
      return new URL(value).protocol === 'https:' ? value : null;
    } catch {
      return null;
    }
  }
}
