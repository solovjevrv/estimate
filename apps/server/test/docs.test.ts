/**
 * Документация API: спецификация собирается из схем роутов, открыта только
 * вне продакшена и не даёт забыть описание у новых эндпоинтов.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import type { AuthConfig } from '../src/config';
import type { Db } from '../src/db';
import { DOCS_PATH, OPENAPI_PATH } from '../src/http/docs.plugin';

const authConfig: AuthConfig = {
  jwtSecret: 'секрет-для-тестов-длиннее-тридцати-двух-символов',
  publicOrigin: 'http://localhost:3000',
  webOrigin: 'http://localhost:5173',
  cookieSecure: false,
  // Ключи ненастоящие: до сети дело не доходит, роуты входа нужны только в спеке
  providers: { google: { clientId: 'test-id', clientSecret: 'test-secret' } },
};

interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  responses?: Record<string, unknown>;
}

type OpenApiSpec = {
  openapi: string;
  info: { title: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
};

let app: FastifyInstance | undefined;

function startApp(docsEnabled: boolean): FastifyInstance {
  app = buildApp({ db: { execute: vi.fn() } as unknown as Db, auth: authConfig, docsEnabled });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('документация API', () => {
  it('отдаёт спецификацию OpenAPI со всеми роутами', async () => {
    const instance = startApp(true);

    const res = await instance.inject({ method: 'GET', url: OPENAPI_PATH });

    expect(res.statusCode).toBe(200);
    const spec = res.json() as OpenApiSpec;
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('Planning Poker API');
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/api/me',
        '/api/auth/providers',
        '/api/auth/google',
        '/api/auth/google/callback',
        '/api/teams',
        '/api/teams/{id}',
        '/api/teams/{id}/members/{userId}',
        '/api/invites/{code}',
        '/api/invites/{code}/join',
      ]),
    );
  });

  it('у каждого роута есть тег, описание и хотя бы один ответ', async () => {
    const instance = startApp(true);

    const spec = (
      await instance.inject({ method: 'GET', url: OPENAPI_PATH })
    ).json() as OpenApiSpec;

    const undocumented: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const documented =
          operation.tags?.length &&
          operation.summary &&
          Object.keys(operation.responses ?? {}).length;
        if (!documented) {
          undocumented.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(undocumented, 'роуты без описания').toEqual([]);
  });

  it('страница документации открывается', async () => {
    const instance = startApp(true);

    // Scalar отдаёт страницу по адресу со слешем, короткий путь ведёт на него
    const redirect = await instance.inject({ method: 'GET', url: DOCS_PATH });
    const page = await instance.inject({ method: 'GET', url: `${DOCS_PATH}/` });

    expect(redirect.statusCode).toBe(301);
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/html/);
  });

  it('на проде документация недоступна', async () => {
    const instance = startApp(false);

    const spec = await instance.inject({ method: 'GET', url: OPENAPI_PATH });
    const page = await instance.inject({ method: 'GET', url: DOCS_PATH });

    expect(spec.statusCode).toBe(404);
    expect(page.statusCode).toBe(404);
    expect(spec.json()).toMatchObject({ error: 'not_found' });
  });
});
