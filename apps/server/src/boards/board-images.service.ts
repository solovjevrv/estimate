import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { boardImageUrl, isBoardImageUrl } from '@poker/shared';
import sharp from 'sharp';

import { ValidationError } from '../errors';
import type { ObjectStorage } from '../platform/storage';

const BOARD_IMAGE_MAX_DIMENSION = 2048;
const BOARD_IMAGE_WEBP_QUALITY = 82;
export const FILENAME_RE = /^[a-f0-9]{32}\.webp$/;

export function boardImageKey(boardId: string, filename: string): string {
  return `boards/${boardId}/images/${filename}`;
}

/**
 * Хранит и пережимает картинки досок в ObjectStorage (Epic 21). `legacyDir`,
 * если задан, — переходное чтение с локального диска для файлов, загруженных
 * до перехода на MinIO и ещё не мигрированных migrate-board-images.ts. Убрать
 * параметр и legacy-методы отдельной задачей после подтверждённой миграции.
 * Легаси-каталог плоский (без boardId в пути) — читать из него напрямую
 * НЕЛЬЗЯ без внешней проверки владения (см. readLegacy), иначе воспроизводится
 * найденная в 21.5 уязвимость межбордовой утечки.
 */
export class BoardImagesService {
  private constructor(
    private readonly storage: ObjectStorage,
    private readonly legacyDir: string | null,
  ) {}

  static create(storage: ObjectStorage, legacyDir?: string): BoardImagesService {
    return new BoardImagesService(storage, legacyDir ?? null);
  }

  /** Чтение из storage — уже безопасно по построению (ключ содержит boardId) */
  async readFromStorage(boardId: string, filename: string): Promise<Readable | null> {
    if (!FILENAME_RE.test(filename)) return null;
    return this.storage.get(boardImageKey(boardId, filename));
  }

  /**
   * Чтение из легаси-каталога — ТОЛЬКО по имени файла, без boardId (каталог
   * плоский). Вызывающий код обязан САМ проверить, что filename реально
   * принадлежит запрошенной доске (см. BoardsService.ownsImage), ПЕРЕД
   * вызовом этого метода — иначе межбордовая утечка (см. п.0).
   */
  async readLegacy(filename: string): Promise<Readable | null> {
    if (!this.legacyDir || !FILENAME_RE.test(filename)) return null;
    const legacyPath = join(this.legacyDir, filename);
    try {
      await stat(legacyPath);
    } catch {
      return null;
    }
    return createReadStream(legacyPath);
  }

  async upload(
    boardId: string,
    buffer: Buffer,
  ): Promise<{ url: string; width: number; height: number }> {
    let processed: Buffer;
    let width: number;
    let height: number;
    try {
      const { data, info } = await sharp(buffer, { failOn: 'error' })
        // Учитывает EXIF-ориентацию исходника, прежде чем её метаданные будут отброшены
        .rotate()
        // Ограничиваем максимальную сторону, сохраняя пропорции
        .resize(BOARD_IMAGE_MAX_DIMENSION, BOARD_IMAGE_MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: BOARD_IMAGE_WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
      processed = data;
      width = info.width;
      height = info.height;
    } catch {
      throw new ValidationError('Файл повреждён или это не изображение');
    }

    const filename = `${randomBytes(16).toString('hex')}.webp`;
    await this.storage.put(boardImageKey(boardId, filename), processed, 'image/webp');

    return { url: boardImageUrl(boardId, filename), width, height };
  }

  /** Удаляет файл отовсюду, где он может физически лежать (storage и/или legacy-диск) */
  async deleteIfOwn(boardId: string, url: string | null): Promise<void> {
    if (!url || !isBoardImageUrl(boardId, url)) return;

    const filename = url.slice(url.lastIndexOf('/') + 1);
    await this.storage.remove(boardImageKey(boardId, filename));
    if (this.legacyDir) {
      await rm(join(this.legacyDir, filename), { force: true });
    }
  }
}
