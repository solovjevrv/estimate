import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { authPlugin } from './auth';
import type { AuthConfig } from './config';
import type { Db } from './db';
import { ErrorHandler } from './http/error-handler';
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
}

export function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(opts);

  app.decorate('db', deps.db);
  new ErrorHandler().register(app);

  if (deps.auth) {
    void app.register(authPlugin, { auth: deps.auth });
    // Командам нужен вошедший пользователь, поэтому только вместе с аутентификацией
    void app.register(teamsPlugin);
  }

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
