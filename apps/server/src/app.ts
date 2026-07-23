import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fp from 'fastify-plugin';

import { authPlugin } from './auth';
import type { AuthConfig } from './config';
import type { Db } from './db';
import { ErrorHandler } from './http/error-handler';
import { healthPlugin } from './http/health.plugin';
import { roomsPlugin } from './rooms';
import { teamsPlugin } from './teams';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
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
}

export function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}): FastifyInstance {
  // coerceTypes выключен, чтобы число в поле-строке не превращалось молча в строку
  const app = Fastify({ ajv: { customOptions: { coerceTypes: false } }, ...opts });

  // Ответы API касаются сессии и состава команд — их нельзя держать в кэшах
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
    }
  });

  app.decorate('db', deps.db);
  new ErrorHandler().register(app);

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

  if (deps.auth) {
    void app.register(authPlugin, { auth: deps.auth });
    // Командам нужен вошедший пользователь, поэтому только вместе с аутентификацией
    void app.register(teamsPlugin);
    void app.register(roomsPlugin);
  }

  if (deps.closeDb) {
    app.addHook('onClose', async () => {
      await deps.closeDb?.();
    });
  }

  return app;
}
