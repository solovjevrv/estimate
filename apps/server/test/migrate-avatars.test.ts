/**
 * Тесты миграции аватарок с диска в ObjectStorage (21.2): идемпотентность,
 * сверка по SHA-256, защита от перезаписи при расхождениих, dry-run, filter
 * по имени файла, сохранение исходников на диске.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { avatarKey } from '../src/auth/avatar.service';
import { migrateAvatars } from '../src/scripts/migrate-avatars';
import { FakeObjectStorage } from '../src/platform/storage';

/** Сформировать валидное имя файла аватарки (32 hex + .webp) */
function randomAvatarFilename(): string {
  return `${randomBytes(16).toString('hex')}.webp`;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe('migrateAvatars', () => {
  let legacyDir: string;
  let storage: FakeObjectStorage;

  beforeEach(() => {
    legacyDir = mkdtempSync(join(tmpdir(), 'poker-migrate-'));
    storage = new FakeObjectStorage();
  });

  afterEach(() => {
    rmSync(legacyDir, { recursive: true, force: true });
  });

  it('переносит новый файл с диска в storage и хеш совпадает', async () => {
    const filename = randomAvatarFilename();
    const buf = Buffer.from('avatar-content');
    writeFileSync(join(legacyDir, filename), buf);

    const report = await migrateAvatars({ legacyDir, storage, dryRun: false });

    expect(report.scanned).toBe(1);
    expect(report.migrated).toBe(1);
    expect(report.alreadyInSync).toBe(0);
    expect(report.mismatches).toHaveLength(0);
    expect(report.errors).toHaveLength(0);

    const stored = storage.peek(avatarKey(filename));
    expect(stored).toBeDefined();
    expect(sha256(stored!.body)).toBe(sha256(buf));
  });

  it('идемпотентна: повторный запуск не переписывает уже совпадающий объект', async () => {
    const filename = randomAvatarFilename();
    const buf = Buffer.from('avatar-content');
    writeFileSync(join(legacyDir, filename), buf);

    const putSpy = vi.spyOn(storage, 'put');

    const first = await migrateAvatars({ legacyDir, storage, dryRun: false });
    expect(first.migrated).toBe(1);

    const second = await migrateAvatars({ legacyDir, storage, dryRun: false });
    expect(second.alreadyInSync).toBe(1);
    expect(second.migrated).toBe(0);

    expect(putSpy).toHaveBeenCalledTimes(1);
    putSpy.mockRestore();
  });

  it('находит расхождение и не перезаписывает объект в storage', async () => {
    const filename = randomAvatarFilename();
    const diskContent = Buffer.from('from-disk');
    const storageContent = Buffer.from('from-storage-different');
    writeFileSync(join(legacyDir, filename), diskContent);
    await storage.put(avatarKey(filename), storageContent, 'image/webp');

    const report = await migrateAvatars({ legacyDir, storage, dryRun: false });

    expect(report.mismatches).toContain(filename);
    expect(report.migrated).toBe(0);

    const stored = storage.peek(avatarKey(filename));
    expect(stored).toBeDefined();
    expect(sha256(stored!.body)).toBe(sha256(storageContent));
  });

  it('dry-run ничего не пишет в storage', async () => {
    const filename = randomAvatarFilename();
    const buf = Buffer.from('avatar-content');
    writeFileSync(join(legacyDir, filename), buf);

    const report = await migrateAvatars({ legacyDir, storage, dryRun: true });

    expect(report.migrated).toBe(1);
    expect(report.scanned).toBe(1);
    expect(storage.peek(avatarKey(filename))).toBeUndefined();
  });

  it('игнорирует файлы, не подходящие под FILENAME_RE', async () => {
    writeFileSync(join(legacyDir, randomAvatarFilename()), Buffer.from('a'));
    writeFileSync(join(legacyDir, '.DS_Store'), Buffer.from('b'));
    writeFileSync(join(legacyDir, 'random-name.txt'), Buffer.from('c'));

    const report = await migrateAvatars({ legacyDir, storage, dryRun: false });

    expect(report.scanned).toBe(1);
  });

  it('никогда не удаляет исходный файл с диска', async () => {
    const filename = randomAvatarFilename();
    const buf = Buffer.from('avatar-content');
    writeFileSync(join(legacyDir, filename), buf);

    await migrateAvatars({ legacyDir, storage, dryRun: false });

    expect(existsSync(join(legacyDir, filename))).toBe(true);
  });
});
