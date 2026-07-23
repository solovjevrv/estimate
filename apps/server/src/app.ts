import { sql } from 'drizzle-orm';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';

import { authPlugin } from './auth';
import type { AuthConfig } from './config';
import type { Db } from './db';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export interface AppDeps {
  db: Db;
  /** Закрытие ресурсов БД при остановке сервера */
  closeDb?: () => Promise<void>;
  /** Без настроек аутентификации приложение поднимается без роутов /api/auth/* */
  auth?: AuthConfig;
}

export function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(opts);

  app.decorate('db', deps.db);
  if (deps.auth) {
    void app.register(authPlugin, { auth: deps.auth });
  }

  // Наружу не должно уезжать ничего внутреннего: текст SQL, параметры запроса,
  // адрес БД. Клиент получает обезличенный ответ, подробности остаются в логах.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, 'Необработанная ошибка запроса');
      return reply.code(status).send({ error: 'internal', message: 'Внутренняя ошибка сервера' });
    }
    req.log.warn({ err }, 'Запрос отклонён');
    return reply.code(status).send({ error: err.code ?? 'bad_request', message: err.message });
  });
  if (deps.closeDb) {
    app.addHook('onClose', async () => {
      await deps.closeDb?.();
    });
  }

  app.get('/health', async (_req, reply) => {
    try {
      await app.db.execute(sql`select 1`);
    } catch (err) {
      app.log.error(err, 'БД недоступна');
      return reply.code(503).send({ status: 'degraded', db: 'down', uptime: process.uptime() });
    }
    return { status: 'ok', db: 'ok', uptime: process.uptime() };
  });

  return app;
}
