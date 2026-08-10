import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import fastifyMultipart from '@fastify/multipart';
import { BOARD_IMAGE_ALLOWED_MIME_TYPES, BOARD_IMAGE_MAX_BYTES } from '@poker/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { DOCS_TAGS, errorResponse } from '../http/openapi';

import { BoardImagesService } from './board-images.service';
import { BoardsService } from './boards.service';

export interface BoardImagesPluginOptions {
  assetsDir: string;
}

const ALLOWED_MIME = new Set<string>(BOARD_IMAGE_ALLOWED_MIME_TYPES);

async function boardImagesPluginImpl(
  app: FastifyInstance,
  opts: BoardImagesPluginOptions,
): Promise<void> {
  const authenticate = app.authenticate;
  if (!authenticate) {
    throw new Error('Роуты картинок досок требуют плагина аутентификации');
  }

  const service = await BoardImagesService.forDirectory(opts.assetsDir);

  // Свой encapsulation-контекст (обычный register, не fp) только для
  // multipart+роутов: @fastify/multipart уже зарегистрирован аватарками
  // (avatar.plugin.ts) тем же fp()-приёмом на общем инстансе — вторая
  // регистрация плагина multipart на том же неизолированном инстансе падает
  // с FST_ERR_DEC_ALREADY_PRESENT (декоратор multipartErrors уже занят).
  await app.register(async (instance) => {
    await instance.register(fastifyMultipart, {
      limits: { fileSize: BOARD_IMAGE_MAX_BYTES, files: 1 },
    });

    // POST /api/boards/:id/assets — загрузка картинки (требует edit-доступ)
    instance.post<{ Params: { id: string } }>(
      '/api/boards/:id/assets',
      {
        preHandler: authenticate,
        schema: {
          tags: [DOCS_TAGS.boards],
          summary: 'Загрузить картинку на доску',
          description:
            'multipart/form-data с одним файлом (JPEG/PNG/WebP/GIF, до 8 МБ). Пережимается в WebP с ограничением стороны 2048px. Требует права редактирования доски.',
          security: [{ session: [] }],
          consumes: ['multipart/form-data'],
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          response: {
            200: {
              description: 'Картинка загружена',
              type: 'object',
              properties: {
                url: { type: 'string' },
                width: { type: 'integer' },
                height: { type: 'integer' },
              },
            },
            400: { description: 'Файл не изображение или не передан', ...errorResponse },
            401: { description: 'Требуется вход', ...errorResponse },
            403: { description: 'Нет прав редактировать эту доску', ...errorResponse },
            404: { description: 'Доска не найдена', ...errorResponse },
            413: { description: 'Файл больше 8 МБ', ...errorResponse },
          },
        },
      },
      async (req, reply) => {
        const boardId = req.params.id;
        const boardsService = BoardsService.forDatabase(app.db);

        // Проверяем edit-доступ к доске
        try {
          await boardsService.assertEditAccess(req.user.sub, boardId);
        } catch (err) {
          if (err instanceof NotFoundError) {
            throw new NotFoundError('Доска не найдена');
          }
          if (err instanceof ForbiddenError) {
            throw new ForbiddenError('Нет прав редактировать эту доску');
          }
          throw err;
        }

        const file = await req.file();
        if (!file) {
          throw new ValidationError('Файл не передан');
        }
        if (!ALLOWED_MIME.has(file.mimetype)) {
          throw new ValidationError('Поддерживаются только JPEG, PNG, WebP и GIF');
        }

        const buffer = await file.toBuffer();
        const result = await service.upload(boardId, buffer);
        return reply.send(result);
      },
    );

    // GET /api/boards/:id/assets/:filename — отдача картинки (требует view-доступ к доске)
    instance.get<{ Params: { id: string; filename: string } }>(
      '/api/boards/:id/assets/:filename',
      {
        preHandler: authenticate,
        schema: {
          tags: [DOCS_TAGS.boards],
          summary: 'Файл картинки доски',
          description:
            'Требует view-доступ к доске (членство в команде или владение личной доской).',
          security: [{ session: [] }],
          params: {
            type: 'object',
            required: ['id', 'filename'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              filename: { type: 'string', pattern: '^[a-f0-9]{32}\\.webp$' },
            },
          },
          response: {
            401: { description: 'Требуется вход', ...errorResponse },
            403: { description: 'Нет доступа к доске', ...errorResponse },
            404: { description: 'Картинка не найдена', ...errorResponse },
          },
        },
      },
      async (req, reply) => {
        const boardId = req.params.id;
        const filename = req.params.filename;
        const boardsService = BoardsService.forDatabase(app.db);

        // Проверяем view-доступ к доске (как у GET /api/boards/:id)
        try {
          await boardsService.assertViewAccess(req.user.sub, boardId);
        } catch (err) {
          if (err instanceof NotFoundError) {
            throw new NotFoundError('Доска не найдена');
          }
          if (err instanceof ForbiddenError) {
            throw new ForbiddenError('Нет доступа к этой доске');
          }
          throw err;
        }

        const path = service.filePath(filename);
        if (!path) {
          throw new NotFoundError('Картинка не найдена');
        }
        try {
          await stat(path);
        } catch {
          throw new NotFoundError('Картинка не найдена');
        }
        // Имя файла случайное и меняется при каждой загрузке — можно кэшировать навсегда
        reply.header('cache-control', 'public, max-age=31536000, immutable');
        reply.type('image/webp');
        return reply.send(createReadStream(path));
      },
    );
  });
}

export const boardImagesPlugin = fp(boardImagesPluginImpl, {
  name: 'poker-board-images',
  dependencies: ['poker-auth'],
});
