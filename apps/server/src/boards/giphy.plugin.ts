import { Readable } from 'node:stream';

import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { GiphyConfig } from '../config';
import { NotFoundError } from '../errors';
import { DOCS_TAGS, errorResponse } from '../http/openapi';

import { GiphyClient } from './giphy-client';
import { GIPHY_MEDIA_VARIANTS, GIPHY_SEARCH_LIMIT_MAX, GiphyService } from './giphy.service';

const DEFAULT_LIMIT = 24;

/** JSON Schema для одного результата поиска в ответе */
const giphyGifResponse = {
  type: 'object',
  required: ['id', 'title', 'previewWidth', 'previewHeight', 'width', 'height'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    previewWidth: { type: 'integer' },
    previewHeight: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
  },
} as const;

/** Числовые query-параметры приходят строками (ajv coerceTypes выключен глобально) —
 *  парсим и подрезаем сами, а не полагаемся на JSON Schema type: 'integer' */
function parseBoundedInt(raw: string | undefined, fallback: number, max: number): number {
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

const paginationQuerystring = {
  type: 'object',
  properties: {
    limit: { type: 'string', pattern: '^[0-9]+$' },
    offset: { type: 'string', pattern: '^[0-9]+$' },
  },
} as const;

async function giphyPluginImpl(app: FastifyInstance, opts: { giphy: GiphyConfig }): Promise<void> {
  const service = new GiphyService(new GiphyClient(opts.giphy.apiKey));

  // Публично — как встроенные стикер-паки/emoji-каталог: это не персональная
  // библиотека (в отличие от personal-stickers.plugin.ts), доступ к размещению
  // на конкретной доске и так проверяется на уровне item.create (board-ops.ts).
  // Общий (не per-user) rate limit — защищаем собственную квоту Giphy-ключа
  // от исчерпания, а не честность между пользователями.
  void app.register(async (giphyRoutes) => {
    await giphyRoutes.register(fastifyRateLimit, {
      max: 600,
      timeWindow: '1 minute',
      keyGenerator: () => 'giphy-shared-quota',
      errorResponseBuilder: (_req, context) => {
        const err = new Error(`Слишком много запросов к Giphy, повторите через ${context.after}`);
        (err as Error & { statusCode: number }).statusCode = context.statusCode;
        return err;
      },
    });

    giphyRoutes.get<{ Querystring: { q: string; limit?: string; offset?: string } }>(
      '/api/giphy/search',
      {
        schema: {
          tags: [DOCS_TAGS.boards],
          summary: 'Поиск GIF в Giphy',
          description: 'Проксирует Giphy Search API — сервер держит API-ключ, клиент его не видит.',
          querystring: {
            type: 'object',
            required: ['q'],
            properties: {
              q: { type: 'string', minLength: 1, maxLength: 100 },
              limit: paginationQuerystring.properties.limit,
              offset: paginationQuerystring.properties.offset,
            },
          },
          response: {
            200: {
              description: 'Результаты поиска',
              type: 'object',
              properties: { gifs: { type: 'array', items: giphyGifResponse } },
            },
          },
        },
      },
      async (req) => {
        const limit = parseBoundedInt(req.query.limit, DEFAULT_LIMIT, GIPHY_SEARCH_LIMIT_MAX);
        const offset = parseBoundedInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
        return { gifs: await service.search(req.query.q, limit, offset) };
      },
    );

    giphyRoutes.get<{ Querystring: { limit?: string; offset?: string } }>(
      '/api/giphy/trending',
      {
        schema: {
          tags: [DOCS_TAGS.boards],
          summary: 'Популярные GIF в Giphy',
          description:
            'Проксирует Giphy Trending API — показывается, пока пользователь не ввёл запрос.',
          querystring: paginationQuerystring,
          response: {
            200: {
              description: 'Популярные GIF',
              type: 'object',
              properties: { gifs: { type: 'array', items: giphyGifResponse } },
            },
          },
        },
      },
      async (req) => {
        const limit = parseBoundedInt(req.query.limit, DEFAULT_LIMIT, GIPHY_SEARCH_LIMIT_MAX);
        const offset = parseBoundedInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
        return { gifs: await service.trending(limit, offset) };
      },
    );

    // GET /api/giphy/media/:id/:variant — сервер сам скачивает у Giphy и
    // стримит байты клиенту, а не отдаёт ссылку на media.giphy.com: клиент
    // никогда не обращается к Giphy напрямую (доступность для РФ-аудитории,
    // см. PROGRESS_ARCHIVE.md).
    giphyRoutes.get<{ Params: { id: string; variant: string } }>(
      '/api/giphy/media/:id/:variant',
      {
        schema: {
          tags: [DOCS_TAGS.boards],
          summary: 'Файл GIF (проксируется с Giphy)',
          params: {
            type: 'object',
            required: ['id', 'variant'],
            properties: {
              id: { type: 'string', pattern: '^[A-Za-z0-9]{1,64}$' },
              variant: { type: 'string', enum: [...GIPHY_MEDIA_VARIANTS] },
            },
          },
          response: {
            404: { description: 'GIF не найден', ...errorResponse },
          },
        },
      },
      async (req, reply) => {
        const mediaUrl = await service.resolveMediaUrl(
          req.params.id,
          req.params.variant as (typeof GIPHY_MEDIA_VARIANTS)[number],
        );
        if (!mediaUrl) throw new NotFoundError('GIF не найден');

        const upstream = await fetch(mediaUrl);
        if (!upstream.ok || !upstream.body) throw new NotFoundError('GIF не найден');

        reply.header('cache-control', 'public, max-age=86400, immutable');
        reply.type(upstream.headers.get('content-type') ?? 'image/gif');
        return reply.send(Readable.fromWeb(upstream.body));
      },
    );
  });
}

export const giphyPlugin = fp(giphyPluginImpl, { name: 'estimate-giphy' });
