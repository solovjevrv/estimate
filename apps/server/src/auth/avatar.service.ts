import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import type { AuthUser } from '@estimate/shared';
import sharp from 'sharp';

import { ValidationError } from '../errors';
import type { ObjectStorage } from '../platform/storage';

import type { UsersRepository } from './users.repository';

/** Сторона квадратной аватарки после пережатия — фиксированная, не зависит от исходника */
export const AVATAR_SIZE = 512;
/** Имя файла — только случайный hex + расширение, никогда не выводится из пользовательского ввода */
export const FILENAME_RE = /^[a-f0-9]{32}\.webp$/;
/** Относительный путь — не абсолютный урл с origin (7.x-стиль): иначе в dev, где веб и
 * сервер на разных портах, браузер блокирует картинку как cross-origin (Cross-Origin-Resource-Policy) */
const AVATAR_PATH_PREFIX = '/api/avatars/';
/** Префикс ключа в ObjectStorage — экспортируется, им же пользуется migrate-avatars.ts */
export const AVATAR_KEY_PREFIX = 'avatars/';

export function avatarKey(filename: string): string {
  return `${AVATAR_KEY_PREFIX}${filename}`;
}

/**
 * Хранит и пережимает пользовательские аватарки в ObjectStorage (Epic 21).
 * `legacyDir`, если задан, — переходное чтение с локального диска для файлов,
 * загруженных до перехода на MinIO и ещё не мигрированных migrate-avatars.ts.
 * Убрать параметр и код чтения из legacyDir отдельной задачей после того, как
 * миграция на проде подтверждена сверкой (см. README migrate-avatars.ts).
 */
export class AvatarService {
  private constructor(
    private readonly users: UsersRepository,
    private readonly storage: ObjectStorage,
    private readonly legacyDir: string | null,
  ) {}

  static create(users: UsersRepository, storage: ObjectStorage, legacyDir?: string): AvatarService {
    return new AvatarService(users, storage, legacyDir ?? null);
  }

  /** Поток аватарки по имени файла из URL; null — не наше имя или файла нигде нет */
  async read(filename: string): Promise<Readable | null> {
    if (!FILENAME_RE.test(filename)) return null;

    const fromStorage = await this.storage.get(avatarKey(filename));
    if (fromStorage) return fromStorage;

    if (!this.legacyDir) return null;
    const legacyPath = join(this.legacyDir, filename);
    try {
      await stat(legacyPath);
    } catch {
      return null;
    }
    return createReadStream(legacyPath);
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
    await this.storage.put(avatarKey(filename), processed, 'image/webp');

    const previous = await this.users.findById(userId);
    const updated = await this.users.updateAvatarOverride(
      userId,
      `${AVATAR_PATH_PREFIX}${filename}`,
    );
    await this.deleteIfOwn(previous?.avatarUrl ?? null);
    return updated;
  }

  /** Удаляет старую аватарку отовсюду, где она может физически лежать (storage и/или legacy-диск) */
  private async deleteIfOwn(url: string | null): Promise<void> {
    if (!url?.startsWith(AVATAR_PATH_PREFIX)) return;
    const filename = url.slice(AVATAR_PATH_PREFIX.length);
    if (!FILENAME_RE.test(filename)) return;

    await this.storage.remove(avatarKey(filename));
    if (this.legacyDir) {
      await rm(join(this.legacyDir, filename), { force: true });
    }
  }
}
