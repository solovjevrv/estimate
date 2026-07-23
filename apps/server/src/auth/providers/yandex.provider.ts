import fastifyOauth2, { type ProviderConfiguration } from '@fastify/oauth2';
import type { AuthProvider } from '@poker/shared';

import { OAuthProvider, type OAuthProfile } from './oauth-provider';

export class YandexOAuthProvider extends OAuthProvider {
  readonly name: AuthProvider = 'yandex';
  readonly configuration: ProviderConfiguration = fastifyOauth2.YANDEX_CONFIGURATION;
  readonly scope = ['login:email', 'login:info', 'login:avatar'];

  override async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const data = await this.fetchJson(
      'https://login.yandex.ru/info?format=json',
      `OAuth ${accessToken}`,
    );

    const email = this.requireString(data, 'default_email');
    const avatarId = this.optionalString(data, 'default_avatar_id');

    return {
      providerId: this.requireString(data, 'id'),
      email,
      name:
        this.optionalString(data, 'real_name') ??
        this.optionalString(data, 'display_name') ??
        email,
      avatarUrl:
        avatarId && data.is_avatar_empty !== true
          ? `https://avatars.yandex.net/get-yapic/${encodeURIComponent(avatarId)}/islands-200`
          : null,
    };
  }
}
