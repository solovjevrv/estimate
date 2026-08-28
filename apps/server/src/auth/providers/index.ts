import type { AuthProvider } from '@estimate/shared';

import { GoogleOAuthProvider } from './google.provider';
import { OAuthProvider } from './oauth-provider';
import { YandexOAuthProvider } from './yandex.provider';

/** Реестр провайдеров: включается тот, для которого в окружении есть ключи */
export const OAUTH_PROVIDERS: Record<AuthProvider, OAuthProvider> = {
  google: new GoogleOAuthProvider(),
  yandex: new YandexOAuthProvider(),
};

export { GoogleOAuthProvider, OAuthProvider, YandexOAuthProvider };
export type { OAuthProfile } from './oauth-provider';
