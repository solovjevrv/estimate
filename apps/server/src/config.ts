import { hkdfSync } from 'node:crypto';
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
  /**
   * Секрет для подписи гостевых токенов комнаты — отдельный от jwtSecret (HKDF
   * с доменной меткой), чтобы подпись одной схемы не могла совпасть с другой,
   * даже если обе используют HMAC-SHA256 на одном мастер-секрете.
   */
  guestSecret: string;
  /** Внешний адрес самого сервера — из него собирается redirect_uri для OAuth */
  publicOrigin: string;
  /** Куда вернуть браузер после успешного входа */
  webOrigin: string;
  /** Ставить ли флаг Secure на cookie сессии (выключается только для http-локалки) */
  cookieSecure: boolean;
  /** Провайдеры, для которых заведены client_id/secret; остальные просто выключены */
  providers: Partial<Record<AuthProvider, OAuthCredentials>>;
}

export interface ObjectStorageConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  /** Учётная запись уровня приложения — не root MinIO, права только на свой бакет (21.1) */
  accessKey: string;
  secretKey: string;
  bucket: string;
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
  /** DSN проекта Sentry; не задан — мониторинг ошибок/логов выключен */
  sentryDsn?: string;
  /** Куда пишутся загруженные пользователями аватарки (10.15) */
  avatarsDir: string;
  /** Куда пишутся загруженные картинки досок (13.2) */
  boardAssetsDir: string;
  /**
   * Не задан — объектное хранилище (MinIO, Epic 21) ещё не подключено: `/health`
   * его не проверяет, аватарки/картинки досок по-прежнему пишутся на локальный
   * диск (`avatarsDir`/`boardAssetsDir`). До миграции этих сервисов (21.2/21.5)
   * MinIO поднимается в Compose сам по себе, конфиг сервера — опциональный шаг
   * поверх него, а не жёсткая зависимость запуска.
   */
  objectStorage?: ObjectStorageConfig;
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

/** Отдельный ключ для гостевых токенов, выведенный из общего секрета через HKDF */
function deriveGuestSecret(jwtSecret: string): string {
  const derived = hkdfSync('sha256', jwtSecret, '', 'poker:guest-session', 32);
  return Buffer.from(derived).toString('base64url');
}

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
    guestSecret: deriveGuestSecret(jwtSecret),
    publicOrigin,
    webOrigin,
    cookieSecure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : publicOrigin.startsWith('https://'),
    providers,
  };
}

/**
 * Обе учётные части (access/secret) обязаны идти вместе — как у OAuth-провайдеров
 * выше: одна без другой означает опечатку в конфиге, а не «выключено».
 */
export function loadObjectStorageConfig(): ObjectStorageConfig | undefined {
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!accessKey && !secretKey) return undefined;
  if (!accessKey || !secretKey) {
    throw new Error('Заданы не обе части MINIO_ACCESS_KEY/MINIO_SECRET_KEY');
  }

  const port = Number(process.env.MINIO_PORT ?? 9000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Некорректное значение MINIO_PORT: "${process.env.MINIO_PORT}"`);
  }

  return {
    endpoint: process.env.MINIO_ENDPOINT ?? 'minio',
    port,
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey,
    secretKey,
    bucket: process.env.MINIO_BUCKET ?? 'poker-assets',
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
    sentryDsn: process.env.SENTRY_DSN || undefined,
    avatarsDir: process.env.AVATARS_DIR ?? join(process.cwd(), 'avatars'),
    boardAssetsDir: process.env.BOARD_ASSETS_DIR ?? join(process.cwd(), 'board-assets'),
    objectStorage: loadObjectStorageConfig(),
  };
}
