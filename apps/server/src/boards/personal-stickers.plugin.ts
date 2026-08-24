import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { TelegramConfig } from '../config';
import { NotFoundError } from '../errors';
import { DOCS_TAGS, errorResponse } from '../http/openapi';
import { uuidSchema } from '../http/schemas';
import type { ObjectStorage } from '../platform/storage';

import { PersonalStickersRepository } from './personal-stickers.repository';
import { PersonalStickersService, personalStickerKey } from './personal-stickers.service';
import { TelegramClient } from './telegram-client';

export interface PersonalStickersPluginOptions {
  storage: ObjectStorage;
  telegram: TelegramConfig;
}

/** JSON Schema для одного стикера в ответе */
const personalStickerItemResponse = {
  type: 'object',
  required: ['id', 'emoji'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    emoji: { type: 'string' },
  },
} as const;

/** JSON Schema для пака стикеров в ответе */
const personalStickerPackResponse = {
  type: 'object',
  required: ['id', 'title', 'telegramSetName', 'stickers'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    telegramSetName: { type: 'string' },
    stickers: { type: 'array', items: personalStickerItemResponse },
  },
} as const;

/** Параметры :packId в роутах личных стикеров */
const packIdParams = {
  type: 'object',
  required: ['packId'],
  properties: {
    packId: uuidSchema,
  },
} as const;

/** Параметры :packId/:filename для GET стикера */
const stickerFileParams = {
  type: 'object',
  required: ['packId', 'filename'],
  properties: {
    packId: uuidSchema,
    filename: { type: 'string', pattern: '^[a-f0-9-]{1,64}\\.webp$' },
  },
} as const;

const IMPORT_RATE_LIMIT_MAX = 10;
const IMPORT_RATE_LIMIT_WINDOW = '10 minutes';

async function personalStickersPluginImpl(
  app: FastifyInstance,
  opts: PersonalStickersPluginOptions,
): Promise<void> {
  const authenticate = app.authenticate;
  if (!authenticate) {
    throw new Error('Роуты личных стикеров требуют плагина аутентификации');
  }

  const service = new PersonalStickersService(
    new PersonalStickersRepository(app.db),
    new TelegramClient(opts.telegram.botToken),
    opts.storage,
  );

  // POST / GET list / DELETE — роуты, требующие аутентификации.
  // Дочерний контекст: rate limiter не «съедает» лимит с остальных роутов
  // (аналогично /api/auth/* в auth/plugin.ts).
  void app.register(async (authedRoutes) => {
    await authedRoutes.register(fastifyRateLimit, {
      max: IMPORT_RATE_LIMIT_MAX,
      timeWindow: IMPORT_RATE_LIMIT_WINDOW,
      keyGenerator: (req) => req.user?.sub ?? req.ip,
      errorResponseBuilder: (_req, context) => {
        const err = new Error(`Слишком много запросов, повторите через ${context.after}`);
        (err as Error & { statusCode: number }).statusCode = context.statusCode;
        return err;
      },
    });

    // POST /api/sticker-packs/personal/import
    authedRoutes.post<{ Body: { telegramSetName: string } }>(
      '/api/sticker-packs/personal/import',
      {
        preHandler: authenticate,
        schema: {
          tags: [DOCS_TAGS.boards],
          summary: 'Импортировать стикер-пак из Telegram',
          description:
            'Импортирует публичный статический стикер-пак из Telegram через Bot API. ' +
            'Требуется вход. Лимит: 10 запросов за 10 минут.',
          security: [{ session: [] }],
          body: {
            type: 'object',
            required: ['telegramSetName'],
            properties: {
              telegramSetName: {
                type: 'string',
                minLength: 1,
                maxLength: 64,
                pattern: '^[A-Za-z0-9_]+$',
              },
            },
          },
          response: {
            200: {
              description: 'Пак импортирован',
              type: 'object',
              properties: {
                pack: personalStickerPackResponse,
                skipped: { type: 'integer' },
              },
            },
            400: { description: 'Ошибка импорта', ...errorResponse },
            401: { description: 'Требуется вход', ...errorResponse },
          },
        },
      },
      async (req, reply) => {
        const result = await service.importFromTelegram(req.user.sub, req.body.telegramSetName);
        return reply.send({ pack: result.pack, skipped: result.skipped });
      },
    );

    // GET /api/sticker-packs/personal — только свои паки
    authedRoutes.get(
      '/api/sticker-packs/personal',
      {
        preHandler: authenticate,
        schema: {
          tags: [DOCS_TAGS.boards],
          summary: 'Мои личные стикер-паки',
          description: 'Только паки текущего пользователя.',
          security: [{ session: [] }],
          response: {
            200: {
              description: 'Список паков',
              type: 'object',
              properties: { packs: { type: 'array', items: personalStickerPackResponse } },
            },
            401: { description: 'Требуется вход', ...errorResponse },
          },
        },
      },
      async (req) => ({
        packs: await service.listOwn(req.user.sub),
      }),
    );

    // DELETE /api/sticker-packs/personal/:packId
    authedRoutes.delete<{ Params: { packId: string } }>(
      '/api/sticker-packs/personal/:packId',
      {
        preHandler: authenticate,
        schema: {
          tags: [DOCS_TAGS.boards],
          summary: 'Удалить личный стикер-пак',
          description:
            'Удаляет пак и все связанные стикеры из БД и storage. ' +
            'Доступно только владельцу (чужой пак — 404, а не 403).',
          security: [{ session: [] }],
          params: packIdParams,
          response: {
            204: { description: 'Пак удалён', type: 'null' },
            401: { description: 'Требуется вход', ...errorResponse },
            404: { description: 'Пак не найден или вам не принадлежит', ...errorResponse },
          },
        },
      },
      async (req, reply) => {
        await service.deleteOwn(req.user.sub, req.params.packId);
        return reply.code(204).send();
      },
    );
  });

  // GET /api/sticker-packs/personal/:packId — публично (без preHandler)
  app.get<{ Params: { packId: string } }>(
    '/api/sticker-packs/personal/:packId',
    {
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Метаданные личного стикер-пака',
        description:
          'Публично, без аутентификации: метаданные Telegram-пака, ' +
          'которые нужны для предложения импортировать его себе.',
        params: packIdParams,
        response: {
          200: {
            description: 'Пак найден',
            type: 'object',
            properties: { pack: personalStickerPackResponse },
          },
          404: { description: 'Пак не найден', ...errorResponse },
        },
      },
    },
    async (req, reply) => {
      const pack = await service.getPublic(req.params.packId);
      if (!pack) throw new NotFoundError('Пак не найден');
      return reply.send({ pack });
    },
  );

  // GET /api/stickers/personal/:packId/:filename — публично (без preHandler)
  app.get<{ Params: { packId: string; filename: string } }>(
    '/api/stickers/personal/:packId/:filename',
    {
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Файл личного стикера',
        description:
          'Публично, без аутентификации — отдаёт webp-файл стикера по прямой ссылке, ' +
          'как встроенные стикеры. Раз владелец пака может быть любым, а ключ ' +
          'в storage содержит ownerId, ownerId определяется по packId в БД.',
        params: stickerFileParams,
        response: {
          404: { description: 'Стикер не найден', ...errorResponse },
        },
      },
    },
    async (req, reply) => {
      const ownerId = await service.findPackOwner(req.params.packId);
      if (!ownerId) throw new NotFoundError('Стикер не найден');

      const stickerId = req.params.filename.replace(/\.webp$/, '');
      const key = personalStickerKey(ownerId, req.params.packId, stickerId);
      const stream = await opts.storage.get(key);
      if (!stream) throw new NotFoundError('Стикер не найден');

      reply.header('cache-control', 'public, max-age=31536000, immutable');
      reply.type('image/webp');
      return reply.send(stream);
    },
  );
}

export const personalStickersPlugin = fp(personalStickersPluginImpl, {
  name: 'poker-personal-stickers',
  dependencies: ['poker-auth'],
});
