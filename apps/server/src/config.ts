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

/**
 * Bot API — токен Telegram-бота для импорта личных стикер-паков (21.6).
 * Фича полностью выключена, если токен не задан: роуты не регистрируются вовсе.
 */
export interface TelegramConfig {
  botToken: string;
}

/**
 * Giphy API — ключ для поиска/показа GIF на досках (21.9). Фича полностью
 * выключена, если ключ не задан: роуты не регистрируются вовсе (как у
 * Telegram Bot API выше). Сервер целиком проксирует Giphy — ключ на клиент
 * никогда не попадает, и клиент никогда не обращается к Giphy напрямую.
 */
export interface GiphyConfig {
  apiKey: string;
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
  /** Легаси-каталог аватарок для переходного чтения и migrate:avatars (Epic 21) */
  avatarsDir: string;
  /** Легаси-каталог картинок досок для переходного чтения и migrate:board-images (Epic 21) */
  boardAssetsDir: string;
  /** Каталог исходников встроенных стикер-паков для автозаполнения MinIO при старте (21.3) */
  stickersAssetsDir: string;
  /**
   * MinIO (Epic 21) — обязателен для аватарок (21.2) и картинок досок (21.5):
   * без него их роуты не регистрируются вовсе (см. `app.ts`). `avatarsDir`/
   * `boardAssetsDir` используются только как источник переходного
   * legacy-чтения и для migration-скриптов, не для записи.
   */
  objectStorage?: ObjectStorageConfig;
  /** Telegram Bot API (21.6) — выключена без токена */
  telegram?: TelegramConfig;
  /** Giphy API (21.9) — выключена без ключа */
  giphy?: GiphyConfig;
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

/**
 * Telegram Bot API (21.6) — без токена фича полностью выключена: роуты
 * импорта личных стикеров не регистрируются вовсе (см. app.ts).
 */
export function loadTelegramConfig(): TelegramConfig | undefined {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return undefined;
  return { botToken };
}

/**
 * Giphy API (21.9) — без ключа фича полностью выключена: роуты поиска/показа
 * GIF не регистрируются вовсе (см. app.ts).
 */
export function loadGiphyConfig(): GiphyConfig | undefined {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) return undefined;
  return { apiKey };
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
    stickersAssetsDir:
      process.env.STICKERS_ASSETS_DIR ?? join(process.cwd(), 'assets', 'sticker-packs'),
    objectStorage: loadObjectStorageConfig(),
    telegram: loadTelegramConfig(),
    giphy: loadGiphyConfig(),
  };
}
