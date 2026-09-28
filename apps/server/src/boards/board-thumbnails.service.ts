import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

import sharp from 'sharp';

import { ValidationError } from '../errors';
import type { ObjectStorage } from '../platform/storage';

/** Максимальный размер снимка, присланного браузером. */
export const BOARD_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const BOARD_THUMBNAIL_MAX_WIDTH = 960;
const BOARD_THUMBNAIL_MAX_HEIGHT = 540;
const KEY_RE = /^\d+-[a-f0-9]{32}\.webp$/;

export function boardThumbnailKey(boardId: string, key: string): string {
  return `boards/${boardId}/thumbnails/${key}`;
}

/**
 * Производные изображения доски. Это отдельный namespace от пользовательских
 * картинок: thumbnail можно безболезненно заменить или удалить, не затрагивая
 * содержимое холста.
 */
export class BoardThumbnailsService {
  constructor(private readonly storage: ObjectStorage) {}

  async create(boardId: string, revision: number, source: Buffer): Promise<string> {
    if (source.byteLength === 0 || source.byteLength > BOARD_THUMBNAIL_MAX_BYTES) {
      throw new ValidationError('Превью доски слишком большое');
    }

    let image: Buffer;
    try {
      image = await sharp(source, { failOn: 'error' })
        .rotate()
        .resize(BOARD_THUMBNAIL_MAX_WIDTH, BOARD_THUMBNAIL_MAX_HEIGHT, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      throw new ValidationError('Превью доски должно быть изображением');
    }

    const key = `${revision}-${randomBytes(16).toString('hex')}.webp`;
    await this.storage.put(boardThumbnailKey(boardId, key), image, 'image/webp');
    return key;
  }

  async read(boardId: string, key: string): Promise<Readable | null> {
    if (!KEY_RE.test(key)) return null;
    return this.storage.get(boardThumbnailKey(boardId, key));
  }

  async remove(boardId: string, key: string | null): Promise<void> {
    if (!key || !KEY_RE.test(key)) return;
    await this.storage.remove(boardThumbnailKey(boardId, key));
  }
}
