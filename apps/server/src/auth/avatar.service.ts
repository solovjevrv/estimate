import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AuthUser } from '@poker/shared';
import sharp from 'sharp';

import { ValidationError } from '../errors';

import type { UsersRepository } from './users.repository';

/** Сторона квадратной аватарки после пережатия — фиксированная, не зависит от исходника */
const AVATAR_SIZE = 512;
/** Имя файла — только случайный hex + расширение, никогда не выводится из пользовательского ввода */
const FILENAME_RE = /^[a-f0-9]{32}\.webp$/;
/** Относительный путь — не абсолютный урл с origin (7.x-стиль): иначе в dev, где веб и
 * сервер на разных портах, браузер блокирует картинку как cross-origin (Cross-Origin-Resource-Policy) */
const AVATAR_PATH_PREFIX = '/api/avatars/';

/**
 * Хранит и пережимает пользовательские аватарки на локальном диске (10.15).
 * Исходник клиента не доверенный: всегда пере-кодируется через sharp в
 * фиксированный формат/размер, а не сохраняется как есть.
 */
export class AvatarService {
  private constructor(
    private readonly users: UsersRepository,
    private readonly dir: string,
  ) {}

  static async forDirectory(users: UsersRepository, dir: string): Promise<AvatarService> {
    await mkdir(dir, { recursive: true });
    return new AvatarService(users, dir);
  }

  /** Абсолютный путь на диске для валидного имени файла; null — имя не наше (защита от path traversal) */
  filePath(filename: string): string | null {
    return FILENAME_RE.test(filename) ? join(this.dir, filename) : null;
  }

  async upload(userId: string, buffer: Buffer): Promise<AuthUser> {
    let processed: Buffer;
    try {
      processed = await sharp(buffer, { failOn: 'error' })
        // Учитывает EXIF-ориентацию исходника, прежде чем её метаданные будут отброшены
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new ValidationError('Файл повреждён или это не изображение');
    }

    const filename = `${randomBytes(16).toString('hex')}.webp`;
    await writeFile(join(this.dir, filename), processed);

    const previous = await this.users.findById(userId);
    const updated = await this.users.updateAvatarOverride(
      userId,
      `${AVATAR_PATH_PREFIX}${filename}`,
    );
    await this.deleteIfOwn(previous?.avatarUrl ?? null);
    return updated;
  }

  /** Удаляет файл, только если url указывает на наше же хранилище — внешние URL провайдеров не трогаем */
  private async deleteIfOwn(url: string | null): Promise<void> {
    if (!url?.startsWith(AVATAR_PATH_PREFIX)) return;

    const path = this.filePath(url.slice(AVATAR_PATH_PREFIX.length));
    if (!path) return;
    await rm(path, { force: true });
  }
}
