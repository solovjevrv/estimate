import fastifySwagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { ACCESS_COOKIE } from '../auth';

/** Путь, по которому открывается интерактивная документация */
export const DOCS_PATH = '/api/docs';
/** Путь к самой спецификации OpenAPI */
export const OPENAPI_PATH = '/api/openapi.json';

export const DOCS_TAGS = {
  service: 'Служебные',
  auth: 'Аутентификация',
  teams: 'Команды',
} as const;

/** Общий формат ошибки: на него ссылаются схемы ответов */
export const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Машиночитаемый код ошибки' },
    message: { type: 'string', description: 'Сообщение для пользователя' },
  },
} as const;

async function docsPluginImpl(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Planning Poker API',
        description:
          'REST API покера планирования. Сессия хранится в httpOnly-куках, ' +
          'поэтому запросы из этой страницы уходят с куками текущего браузера.',
        version: '0.1.0',
      },
      tags: [
        { name: DOCS_TAGS.service, description: 'Состояние сервиса' },
        { name: DOCS_TAGS.auth, description: 'Вход через OAuth и сессия' },
        { name: DOCS_TAGS.teams, description: 'Команды, роли и приглашения' },
      ],
      components: {
        securitySchemes: {
          session: {
            type: 'apiKey',
            in: 'cookie',
            name: ACCESS_COOKIE,
            description: 'Access-токен сессии, выставляется после входа через OAuth',
          },
        },
      },
    },
  });

  app.get(OPENAPI_PATH, { schema: { hide: true } }, async () => app.swagger());

  await app.register(scalar, {
    routePrefix: DOCS_PATH,
    configuration: { url: OPENAPI_PATH, title: 'Planning Poker API' },
  });
}

/**
 * Документация API. Включается только вне продакшена: на проде карта
 * эндпоинтов наружу не отдаётся.
 */
export const docsPlugin = fp(docsPluginImpl, { name: 'poker-docs' });
