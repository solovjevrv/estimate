import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { DOCS_TAGS } from './openapi';

const healthResponse = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    db: { type: 'string' },
    storage: { type: 'string' },
    uptime: { type: 'number', description: 'Время работы процесса в секундах' },
  },
} as const;

/**
 * Признак живости сервиса: деплой ждёт этот роут, поэтому он проверяет
 * не только процесс, но и доступность базы (и объектного хранилища, если
 * оно подключено — Epic 21, до миграции 21.2/21.5 остаётся опциональным
 * шагом поверх Compose, см. `Config.objectStorage`).
 * Отдельным плагином — чтобы попасть в спецификацию OpenAPI, которая
 * собирает роуты, зарегистрированные после неё.
 */
async function healthPluginImpl(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: [DOCS_TAGS.service],
        summary: 'Состояние сервиса',
        description: 'Проверяет доступность базы данных и объектного хранилища (если подключено).',
        response: {
          200: { description: 'Сервис и зависимости отвечают', ...healthResponse },
          503: { description: 'База или хранилище недоступны', ...healthResponse },
        },
      },
    },
    async (_req, reply) => {
      let degraded = false;
      let db: 'ok' | 'down' = 'ok';
      let storage: 'ok' | 'down' | undefined;

      try {
        await app.db.execute(sql`select 1`);
      } catch (err) {
        app.log.error(err, 'БД недоступна');
        db = 'down';
        degraded = true;
      }

      if (app.storage) {
        try {
          await app.storage.ping();
          storage = 'ok';
        } catch (err) {
          app.log.error(err, 'Объектное хранилище недоступно');
          storage = 'down';
          degraded = true;
        }
      }

      const body = { status: degraded ? 'degraded' : 'ok', db, storage, uptime: process.uptime() };
      return degraded ? reply.code(503).send(body) : body;
    },
  );
}

export const healthPlugin = fp(healthPluginImpl, { name: 'poker-health' });
