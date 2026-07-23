import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { DOCS_TAGS } from './openapi';

const healthResponse = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    db: { type: 'string' },
    uptime: { type: 'number', description: 'Время работы процесса в секундах' },
  },
} as const;

/**
 * Признак живости сервиса: деплой ждёт этот роут, поэтому он проверяет
 * не только процесс, но и доступность базы.
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
        description: 'Проверяет доступность базы данных.',
        response: {
          200: { description: 'Сервис и база отвечают', ...healthResponse },
          503: { description: 'База недоступна', ...healthResponse },
        },
      },
    },
    async (_req, reply) => {
      try {
        await app.db.execute(sql`select 1`);
      } catch (err) {
        app.log.error(err, 'БД недоступна');
        return reply.code(503).send({ status: 'degraded', db: 'down', uptime: process.uptime() });
      }
      return { status: 'ok', db: 'ok', uptime: process.uptime() };
    },
  );
}

export const healthPlugin = fp(healthPluginImpl, { name: 'poker-health' });
