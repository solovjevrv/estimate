import fastifyMultipart from '@fastify/multipart';
import { AVATAR_ALLOWED_MIME_TYPES, AVATAR_MAX_BYTES } from '@estimate/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { NotFoundError, ValidationError } from '../errors';
import { DOCS_TAGS, errorResponse } from '../http/openapi';
import type { ObjectStorage } from '../platform/storage';

import { AvatarService } from './avatar.service';
import { userResponse } from './plugin';
import { UsersRepository } from './users.repository';

export interface AvatarPluginOptions {
  storage: ObjectStorage;
  /** Каталог легаси-файлов для переходного чтения; не задан — fallback выключен */
  legacyAvatarsDir?: string;
}

const ALLOWED_MIME = new Set<string>(AVATAR_ALLOWED_MIME_TYPES);

const avatarParams = {
  type: 'object',
  required: ['filename'],
  // Расширение фиксировано (мы всегда сохраняем webp) — валидация здесь только
  // защита от мусора в URL, настоящая проверка имени — в AvatarService.read
  properties: { filename: { type: 'string', pattern: '^[a-f0-9]{32}\\.webp$' } },
} as const;

async function avatarPluginImpl(app: FastifyInstance, opts: AvatarPluginOptions): Promise<void> {
  const authenticate = app.authenticate;
  if (!authenticate) {
    throw new Error('Роуты аватарки требуют плагина аутентификации');
  }

  const service = AvatarService.create(
    new UsersRepository(app.db),
    opts.storage,
    opts.legacyAvatarsDir,
  );

  // Свой encapsulation-контекст (обычный register, не fp) только для
  // multipart+роута: картинки досок (board-images.plugin.ts, 13.2) тоже
  // регистрируют @fastify/multipart — на общем неизолированном (fp) инстансе
  // вторая регистрация того же content-type-parser упала бы с
  // FST_ERR_CTP_ALREADY_PRESENT.
  await app.register(async (instance) => {
    await instance.register(fastifyMultipart, {
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
    });

    instance.post(
      '/api/me/avatar',
      {
        preHandler: authenticate,
        schema: {
          tags: [DOCS_TAGS.auth],
          summary: 'Загрузить аватарку',
          description:
            'multipart/form-data с одним файлом (JPEG/PNG/WebP, до 8 МБ). Пережимается в квадрат 512×512.',
          security: [{ session: [] }],
          consumes: ['multipart/form-data'],
          response: {
            200: {
              description: 'Аватарка обновлена',
              type: 'object',
              properties: { user: userResponse },
            },
            400: { description: 'Файл не изображение или не передан', ...errorResponse },
            401: { description: 'Требуется вход', ...errorResponse },
            413: { description: 'Файл больше 8 МБ', ...errorResponse },
          },
        },
      },
      async (req, reply) => {
        const file = await req.file();
        if (!file) {
          throw new ValidationError('Файл не передан');
        }
        if (!ALLOWED_MIME.has(file.mimetype)) {
          throw new ValidationError('Поддерживаются только JPEG, PNG и WebP');
        }

        // toBuffer() сам бросает FST_REQ_FILE_TOO_LARGE (413), если файл больше limits.fileSize
        const buffer = await file.toBuffer();
        const user = await service.upload(req.user.sub, buffer);
        return reply.send({ user });
      },
    );
  });

  app.get<{ Params: { filename: string } }>(
    '/api/avatars/:filename',
    {
      schema: {
        tags: [DOCS_TAGS.auth],
        summary: 'Файл аватарки',
        description: 'Публично: аватарки и так видны всем участникам команд/комнат.',
        params: avatarParams,
        response: {
          404: { description: 'Аватарка не найдена', ...errorResponse },
        },
      },
    },
    async (req, reply) => {
      const stream = await service.read(req.params.filename);
      if (!stream) {
        throw new NotFoundError('Аватарка не найдена');
      }
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      reply.type('image/webp');
      return reply.send(stream);
    },
  );
}

export const avatarPlugin = fp(avatarPluginImpl, {
  name: 'estimate-avatar',
  dependencies: ['estimate-auth'],
});
