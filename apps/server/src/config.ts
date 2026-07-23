import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AUTH_PROVIDERS, type AuthProvider } from '@poker/shared';

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  /** Секрет для подписи JWT сессии */
  jwtSecret: string;
  /** Внешний адрес самого сервера — из него собирается redirect_uri для OAuth */
  publicOrigin: string;
  /** Куда вернуть браузер после успешного входа */
  webOrigin: string;
  /** Ставить ли флаг Secure на cookie сессии (выключается только для http-локалки) */
  cookieSecure: boolean;
  /** Провайдеры, для которых заведены client_id/secret; остальные просто выключены */
  providers: Partial<Record<AuthProvider, OAuthCredentials>>;
}

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Origin дев-фронта для CORS Socket.io; в проде фронт same-origin через nginx */
  webOrigin: string;
  /** Документация API: на проде карта эндпоинтов наружу не отдаётся */
  docsEnabled: boolean;
  auth: AuthConfig;
}

/**
 * Локальная разработка: ищем .env вверх от cwd (корень монорепы или apps/server).
 * В контейнере/CI файла нет — переменные приходят из окружения.
 * Уже заданные переменные имеют приоритет: loadEnvFile их не перезаписывает.
 */
function loadDotenv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 3; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    dir = dirname(dir);
  }
}

/** Минимальная длина секрета: 32 символа случайной строки (openssl rand -base64 48) */
const MIN_JWT_SECRET_LENGTH = 32;

function loadAuthConfig(webOrigin: string, port: number): AuthConfig {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET не задан или короче ${MIN_JWT_SECRET_LENGTH} символов (сгенерируйте: openssl rand -base64 48)`,
    );
  }

  const publicOrigin = (process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`).replace(
    /\/+$/,
    '',
  );

  const providers: Partial<Record<AuthProvider, OAuthCredentials>> = {};
  for (const provider of AUTH_PROVIDERS) {
    const prefix = provider.toUpperCase();
    const clientId = process.env[`${prefix}_CLIENT_ID`];
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
    if (clientId && clientSecret) {
      providers[provider] = { clientId, clientSecret };
    } else if (clientId || clientSecret) {
      throw new Error(`Для провайдера ${provider} задан только один из CLIENT_ID/CLIENT_SECRET`);
    }
  }

  return {
    jwtSecret,
    publicOrigin,
    webOrigin,
    cookieSecure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : publicOrigin.startsWith('https://'),
    providers,
  };
}

export function loadConfig(): Config {
  loadDotenv();

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Некорректное значение PORT: "${process.env.PORT}"`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL не задан');
  }

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    port,
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl,
    webOrigin,
    // По умолчанию документация есть везде, кроме продакшена; флагом можно переопределить
    docsEnabled: process.env.DOCS_ENABLED ? process.env.DOCS_ENABLED === 'true' : !isProduction,
    auth: loadAuthConfig(webOrigin, port),
  };
}
