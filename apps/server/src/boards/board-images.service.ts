import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';

import { boardImageUrl, isBoardImageUrl } from '@poker/shared';

import { ValidationError } from '../errors';

/** Максимальная сторона картинки после пережатия — защита от гигантских исходников */
const BOARD_IMAGE_MAX_DIMENSION = 2048;
/** Качество WebP — тот же баланс, что у аватарок */
const BOARD_IMAGE_WEBP_QUALITY = 82;
/** Имя файла — только случайный hex + расширение, никогда не выводится из пользовательского ввода */
const FILENAME_RE = /^[a-f0-9]{32}\.webp$/;

/**
 * Хранит и пережимает картинки досок на локальном диске (13.2).
 * Исходник клиента не доверенный: всегда пере-кодируется через sharp в
 * WebP с ограничением максимальной стороны, а не сохраняется как есть.
 * Имя файла генерируется сервером (randomBytes), путь-траверсал закрыт
 * regex-валидацией имени.
 */
export class BoardImagesService {
  private constructor(private readonly dir: string) {}

  static async forDirectory(dir: string): Promise<BoardImagesService> {
    await mkdir(dir, { recursive: true });
    return new BoardImagesService(dir);
  }

  /** Абсолютный путь на диске для валидного имени файла; null — имя не наше (защита от path traversal) */
  filePath(filename: string): string | null {
    return FILENAME_RE.test(filename) ? join(this.dir, filename) : null;
  }

  /** Загружает картинку, пережимает в WebP с ограничением стороны, возвращает относительный URL */
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
    await writeFile(join(this.dir, filename), processed);

    return { url: boardImageUrl(boardId, filename), width, height };
  }

  /** Удаляет файл, только если url указывает на картинку именно этой доски */
  async deleteIfOwn(boardId: string, url: string | null): Promise<void> {
    if (!url || !isBoardImageUrl(boardId, url)) return;

    const filename = url.slice(url.lastIndexOf('/') + 1);
    const path = this.filePath(filename);
    if (!path) return;
    await rm(path, { force: true });
  }
}
