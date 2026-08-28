import fastifySwagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { ACCESS_COOKIE } from '../auth';

import { DOCS_PATH, DOCS_TAGS, OPENAPI_PATH } from './openapi';

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
        { name: DOCS_TAGS.rooms, description: 'Комнаты и раунды оценки' },
      ],
      components: {
        securitySchemes: {
          session: {
            type: 'apiKey',
            in: 'cookie',
            name: ACCESS_COOKIE,
            description: 'Access-токен сессии, выставляется после входа через OAuth',
          },
          refresh: {
            type: 'apiKey',
            in: 'cookie',
            name: 'pp_refresh',
            description: 'Refresh-токен, используется только эндпоинтом продления сессии',
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
 * Документация API. Модуль подключается динамически: на проде документация
 * выключена, и тяжёлая страница Scalar не должна попадать в память процесса.
 */
export const docsPlugin = fp(docsPluginImpl, { name: 'estimate-docs' });
