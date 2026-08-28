import type { AuthProvider } from '@estimate/shared';

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  google: 'Google',
  yandex: 'Яндекс',
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider as AuthProvider] ?? provider;
}
