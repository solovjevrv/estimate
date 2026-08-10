import { describe, expect, it } from 'vitest';

import { findStickerAsset, STICKER_PACKS } from '../src/lib/board/sticker-packs';

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
