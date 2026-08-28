/**
 * Тесты наполнения MinIO встроенными стикер-паками (21.3): идемпотентность,
 * сверка по SHA-256, защита от перезаписи при расхождении, dry-run, filter
 * по имени файла, разные pack-директории с одинаковыми именами файлов.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedStickers, stickerKey } from '../src/scripts/seed-stickers';
import { FakeObjectStorage } from '../src/platform/storage';

/** Сформировать валидное имя файла стикера (hex + .webp) */
function randomStickerFilename(): string {
  return `${Math.random().toString(36).slice(2, 10)}.webp`;
}

describe('seedStickers', () => {
  let assetsDir: string;
  let storage: FakeObjectStorage;

  beforeEach(() => {
    assetsDir = mkdtempSync(join(tmpdir(), 'estimate-stickers-'));
    storage = new FakeObjectStorage();
  });

  afterEach(() => {
    rmSync(assetsDir, { recursive: true, force: true });
  });

  /** Создать pack-директорию с файлами: { filename: content } */
  function makePack(pack: string, files: Record<string, Buffer>): void {
    const packDir = join(assetsDir, pack);
    mkdirSync(packDir, { recursive: true });
    for (const [filename, content] of Object.entries(files)) {
      writeFileSync(join(packDir, filename), content);
    }
  }

  it('переносит новый файл из вложенной pack-директории в storage под ключ stickers/v1/:pack/:id.webp', async () => {
    const pack = 'dev-pack';
    const filename = randomStickerFilename();
    const buf = Buffer.from('sticker-content');
    makePack(pack, { [filename]: buf });

    const report = await seedStickers({ assetsDir, storage, dryRun: false });

    expect(report.scanned).toBe(1);
    expect(report.uploaded).toBe(1);
    expect(report.alreadyInSync).toBe(0);
    expect(report.mismatches).toHaveLength(0);
    expect(report.errors).toHaveLength(0);

    const stored = storage.peek(stickerKey(pack, filename));
    expect(stored).toBeDefined();
    expect(stored!.body.toString('hex')).toBe(buf.toString('hex'));
  });

  it('идемпотентна: повторный запуск не переписывает уже совпадающий объект', async () => {
    const pack = 'dev-pack';
    const filename = randomStickerFilename();
    const buf = Buffer.from('sticker-content');
    makePack(pack, { [filename]: buf });

    const putSpy = vi.spyOn(storage, 'put');

    const first = await seedStickers({ assetsDir, storage, dryRun: false });
    expect(first.uploaded).toBe(1);

    const second = await seedStickers({ assetsDir, storage, dryRun: false });
    expect(second.alreadyInSync).toBe(1);
    expect(second.uploaded).toBe(0);

    expect(putSpy).toHaveBeenCalledTimes(1);
    putSpy.mockRestore();
  });

  it('находит расхождение и не перезаписывает объект в storage', async () => {
    const pack = 'dev-pack';
    const filename = randomStickerFilename();
    const diskContent = Buffer.from('from-disk');
    const storageContent = Buffer.from('from-storage-different');
    makePack(pack, { [filename]: diskContent });
    await storage.put(stickerKey(pack, filename), storageContent, 'image/webp');

    const report = await seedStickers({ assetsDir, storage, dryRun: false });

    expect(report.mismatches).toContain(`${pack}/${filename}`);
    expect(report.uploaded).toBe(0);

    const stored = storage.peek(stickerKey(pack, filename));
    expect(stored).toBeDefined();
    expect(stored!.body.toString('hex')).toBe(storageContent.toString('hex'));
  });

  it('dry-run ничего не пишет в storage', async () => {
    const pack = 'dev-pack';
    const filename = randomStickerFilename();
    const buf = Buffer.from('sticker-content');
    makePack(pack, { [filename]: buf });

    const report = await seedStickers({ assetsDir, storage, dryRun: true });

    expect(report.uploaded).toBe(1);
    expect(report.scanned).toBe(1);
    expect(storage.peek(stickerKey(pack, filename))).toBeUndefined();
  });

  it('игнорирует файлы, не подходящие под .webp (например .DS_Store внутри pack-директории)', async () => {
    makePack('dev-pack', {
      [randomStickerFilename()]: Buffer.from('a'),
      '.DS_Store': Buffer.from('b'),
      'random-name.txt': Buffer.from('c'),
    });

    const report = await seedStickers({ assetsDir, storage, dryRun: false });

    expect(report.scanned).toBe(1);
  });

  it('разные паке с одинаковым именем файла не конфликтуют (разные ключи)', async () => {
    // stickers/v1/pack-a/01.webp !== stickers/v1/pack-b/01.webp
    const filename = '01.webp';
    makePack('pack-a', { [filename]: Buffer.from('content-a') });
    makePack('pack-b', { [filename]: Buffer.from('content-b') });

    const report = await seedStickers({ assetsDir, storage, dryRun: false });

    expect(report.scanned).toBe(2);
    expect(report.uploaded).toBe(2);

    const storedA = storage.peek(stickerKey('pack-a', filename));
    const storedB = storage.peek(stickerKey('pack-b', filename));
    expect(storedA).toBeDefined();
    expect(storedB).toBeDefined();
    expect(storedA!.body.toString('hex')).not.toBe(storedB!.body.toString('hex'));
  });
});
