import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findStickerAsset, STICKER_PACKS } from '../src/features/boards/config/sticker-packs';

describe('STICKER_PACKS', () => {
  it('не пустой и содержит несколько паков', () => {
    expect(STICKER_PACKS.length).toBeGreaterThan(0);
  });

  it('у каждого пака непустой id/label и хотя бы один стикер', () => {
    for (const pack of STICKER_PACKS) {
      expect(pack.id.length).toBeGreaterThan(0);
      expect(pack.label.length).toBeGreaterThan(0);
      expect(pack.items.length).toBeGreaterThan(0);
    }
  });

  it('id паков уникальны', () => {
    const ids = STICKER_PACKS.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('у каждого пака id стикеров уникальны, а src резолвится в непустую строку', () => {
    for (const pack of STICKER_PACKS) {
      const ids = pack.items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const item of pack.items) {
        expect(item.src.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('findStickerAsset', () => {
  it('находит существующий стикер по pack/id', () => {
    const pack = STICKER_PACKS[0]!;
    const item = pack.items[0]!;
    expect(findStickerAsset(pack.id, item.id)).toEqual(item);
  });

  it('возвращает undefined для неизвестного пака', () => {
    expect(findStickerAsset('no-such-pack', '01')).toBeUndefined();
  });

  it('возвращает undefined для неизвестного id внутри существующего пака', () => {
    const pack = STICKER_PACKS[0]!;
    expect(findStickerAsset(pack.id, 'no-such-id')).toBeUndefined();
  });
});

describe('STICKER_PACKS ↔ apps/server/assets/sticker-packs — консистентность', () => {
  const assetsRoot = join(__dirname, '../../server/assets/sticker-packs');

  it('каждому pack/id из STICKER_PACKS соответствует реальный .webp-файл на сервере', () => {
    for (const pack of STICKER_PACKS) {
      for (const item of pack.items) {
        const files = readdirSync(join(assetsRoot, pack.id));
        expect(files).toContain(`${item.id}.webp`);
      }
    }
  });

  it('на сервере нет файлов-сирот, не описанных в STICKER_PACKS', () => {
    // Индекс: pack.id → Set<id стикера>
    const index = new Map<string, Set<string>>();
    for (const pack of STICKER_PACKS) {
      const ids = new Set<string>();
      for (const item of pack.items) {
        ids.add(item.id);
      }
      index.set(pack.id, ids);
    }

    // Обратная проверка: каждый .webp-файл в assetsRoot/<pack>/ должен быть
    // описан в STICKER_PACKS
    for (const packDir of readdirSync(assetsRoot, { withFileTypes: true })) {
      if (!packDir.isDirectory()) continue;
      const packId = packDir.name;
      const declaredIds = index.get(packId);
      expect(
        declaredIds,
        `pack "${packId}" есть на диске, но отсутствует в STICKER_PACKS`,
      ).toBeDefined();

      const files = readdirSync(join(assetsRoot, packId));
      for (const file of files) {
        expect(file).toMatch(/^[a-z0-9-]+\.webp$/i);
        const stickerId = file.replace(/\.webp$/i, '');
        expect(
          declaredIds!.has(stickerId),
          `стикер ${packId}/${file} есть на диске, но не описан в STICKER_PACKS`,
        ).toBe(true);
      }
    }
  });
});
