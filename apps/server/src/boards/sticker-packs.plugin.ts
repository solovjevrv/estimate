import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { NotFoundError } from '../errors';
import { DOCS_TAGS, errorResponse } from '../http/openapi';
import type { ObjectStorage } from '../platform/storage';

export interface StickerPacksPluginOptions {
  storage: ObjectStorage;
}

const stickerParams = {
  type: 'object',
  required: ['version', 'pack', 'filename'],
  properties: {
    version: { type: 'string', pattern: '^v[0-9]+$' },
    pack: { type: 'string', pattern: '^[a-z0-9-]{1,64}$' },
    filename: { type: 'string', pattern: '^[a-z0-9-]{1,64}\\.webp$' },
  },
} as const;

async function stickerPacksPluginImpl(
  app: FastifyInstance,
  opts: StickerPacksPluginOptions,
): Promise<void> {
  app.get<{ Params: { version: string; pack: string; filename: string } }>(
    '/api/stickers/:version/:pack/:filename',
    {
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Файл встроенного стикера',
        description: 'Публично, без аутентификации: стикеры и раньше были частью бандла фронта.',
        params: stickerParams,
        response: { 404: { description: 'Стикер не найден', ...errorResponse } },
      },
    },
    async (req, reply) => {
      const { version, pack, filename } = req.params;
      const stream = await opts.storage.get(`stickers/${version}/${pack}/${filename}`);
      if (!stream) {
        throw new NotFoundError('Стикер не найден');
      }
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      reply.type('image/webp');
      return reply.send(stream);
    },
  );
}

export const stickerPacksPlugin = fp(stickerPacksPluginImpl, { name: 'poker-sticker-packs' });
