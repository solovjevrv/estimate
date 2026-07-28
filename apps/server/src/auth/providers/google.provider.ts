import fastifyOauth2, { type ProviderConfiguration } from '@fastify/oauth2';
import type { AuthProvider } from '@poker/shared';

import { OAuthProvider, type OAuthProfile } from './oauth-provider';

export class GoogleOAuthProvider extends OAuthProvider {
  readonly name: AuthProvider = 'google';
  readonly configuration: ProviderConfiguration = fastifyOauth2.GOOGLE_CONFIGURATION;
  readonly scope = ['openid', 'email', 'profile'];
  /** Иначе Google молча логинит тем же аккаунтом, что был выбран в прошлый раз (7.19) */
  override readonly authorizeParams = { prompt: 'select_account' };

  override async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const data = await this.fetchJson(
      'https://openidconnect.googleapis.com/v1/userinfo',
      `Bearer ${accessToken}`,
    );

    const email = this.requireString(data, 'email');
    // Неподтверждённой почте доверять нельзя: дальше по ней зовут в команды
    if (data.email_verified !== true) {
      throw new Error('Google: email не подтверждён');
    }

    return {
      providerId: this.requireString(data, 'sub'),
      email,
      name: this.optionalString(data, 'name') ?? email,
      avatarUrl: this.safeAvatarUrl(this.optionalString(data, 'picture')),
    };
  }
}
