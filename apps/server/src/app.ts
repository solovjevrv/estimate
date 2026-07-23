import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

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
}

export function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(opts);

  app.decorate('db', deps.db);
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
