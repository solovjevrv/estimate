import fastifyHelmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fp from 'fastify-plugin';

import { authPlugin, avatarPlugin, sessionCleanupPlugin } from './auth';
import {
  boardsPlugin,
  boardImagesPlugin,
  giphyPlugin,
  personalStickersPlugin,
  stickerPacksPlugin,
} from './boards';
import type { AuthConfig, GiphyConfig, TelegramConfig } from './config';
import type { Db } from './db';
import { ErrorHandler } from './http/error-handler';
import { healthPlugin } from './http/health.plugin';
import type { ObjectStorage } from './platform/storage';
import { roomsPlugin, type RoomsRateLimitOptions } from './rooms';
import { teamsPlugin } from './teams';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    /** Не задан — объектное хранилище (Epic 21) ещё не подключено, см. `Config.objectStorage` */
    storage?: ObjectStorage;
  }
}

export interface AppDeps {
  db: Db;
  /** Закрытие ресурсов БД при остановке сервера */
  closeDb?: () => Promise<void>;
  /** Без настроек аутентификации приложение поднимается без роутов /api/auth/* и /api/teams */
  auth?: AuthConfig;
  /** Документация OpenAPI: включена везде, кроме продакшена */
  docsEnabled?: boolean;
  /** Переопределение лимита /api/rooms/* — нужно интеграционным тестам (7.34) */
  roomsRateLimit?: RoomsRateLimitOptions;
  /**
   * Легаси-каталог аватарок для переходного чтения (Epic 21); без него — только storage.
   * Без auth не используется.
   */
  avatarsDir?: string;
  /**
   * Легаси-каталог картинок досок для переходного чтения (Epic 21); без auth не используется
   */
  boardAssetsDir?: string;
  /** Не задан — MinIO (Epic 21) ещё не подключен; `/health` в этом случае его не проверяет */
  objectStorage?: ObjectStorage;
  /** Telegram Bot API (21.6) — выключена без токена */
  telegram?: TelegramConfig;
  /** Giphy API (21.9) — выключена без ключа */
  giphy?: GiphyConfig;
}

export function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}): FastifyInstance {
  // coerceTypes выключен, чтобы число в поле-строке не превращалось молча в строку
  const app = Fastify({ ajv: { customOptions: { coerceTypes: false } }, ...opts });

  // Ответы API касаются сессии и состава команд — их нельзя держать в кэшах.
  // Аватарки, картинки досок, стикеры и файлы Giphy — исключение: отдаются под
  // тем же /api/ (см. nginx/vite-прокси), но их собственный cache-control
  // (10.15, 13.2, 21.3, 21.9) не должен затираться этим хуком.
  const CACHEABLE_ASSET_PATTERN =
    /^\/api\/(avatars\/|boards\/[^/]+\/assets\/|stickers\/|giphy\/media\/)/;
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/') && !CACHEABLE_ASSET_PATTERN.test(req.url)) {
      reply.header('cache-control', 'no-store');
    }
  });

  app.decorate('db', deps.db);
  app.decorate('storage', deps.objectStorage);
  new ErrorHandler().register(app);

  // Базовая защита заголовками (clickjacking, MIME-sniffing и т.п.). CSP выключена:
  // API отдаёт только JSON, а страница документации (Scalar, только вне прод) сама
  // грузит инлайн-скрипты — точечная политика под неё не стоит сложности сейчас.
  void app.register(fastifyHelmet, { contentSecurityPolicy: false });

  // Swagger видит только роуты, зарегистрированные после него, поэтому
  // документация подключается первой. Импорт динамический: на проде она
  // выключена, и страница Scalar (почти 4 МБ) не должна попадать в память.
  if (deps.docsEnabled) {
    void app.register(
      fp(
        async (instance) => {
          try {
            const { docsPlugin } = await import('./http/docs.plugin');
            await instance.register(docsPlugin);
          } catch (err) {
            // В прод-образе пакетов документации нет — это не повод падать
            instance.log.warn({ err }, 'Документация API недоступна в этой сборке');
          }
        },
        { name: 'poker-docs-loader' },
      ),
    );
  }

  void app.register(healthPlugin);

  // Giphy (21.9) не требует аутентификации вовсе (публично, как встроенные
  // стикер-паки/emoji-каталог) и не зависит от объектного хранилища — сервер
  // только проксирует, ничего не персистит в MinIO. Регистрируется вне блока
  // `deps.auth` намеренно: в отличие от остальных плагинов ниже, ему
  // инфраструктура аутентификации не нужна ни для одного роута.
  if (deps.giphy) {
    void app.register(giphyPlugin, { giphy: deps.giphy });
  }

  if (deps.auth) {
    void app.register(authPlugin, { auth: deps.auth });
    void app.register(sessionCleanupPlugin);
    if (deps.objectStorage) {
      void app.register(avatarPlugin, {
        storage: deps.objectStorage,
        legacyAvatarsDir: deps.avatarsDir,
      });
      void app.register(boardImagesPlugin, {
        storage: deps.objectStorage,
        legacyAssetsDir: deps.boardAssetsDir,
        auth: deps.auth,
      });
      void app.register(stickerPacksPlugin, {
        storage: deps.objectStorage,
      });
      if (deps.telegram) {
        void app.register(personalStickersPlugin, {
          storage: deps.objectStorage,
          telegram: deps.telegram,
        });
      }
    }
    // Командам нужен вошедший пользователь, поэтому только вместе с аутентификацией
    void app.register(teamsPlugin);
    void app.register(roomsPlugin, { rateLimit: deps.roomsRateLimit });
    // Доскам нужны и аутентификация, и проверка членства в команде — регистрируем после teamsPlugin
    void app.register(boardsPlugin, {
      objectStorage: deps.objectStorage,
      legacyAssetsDir: deps.boardAssetsDir,
      auth: deps.auth,
    });
  }

  if (deps.closeDb) {
    app.addHook('onClose', async () => {
      await deps.closeDb?.();
    });
  }

  return app;
}
