import { describe, expect, it } from 'vitest';

import { EMOJI_CATALOG } from '../src/emoji/catalog.generated';
import { isValidEmojiSequence } from '../src/emoji/validate';
import { EMOJI_GROUPS } from '../src/emoji/index';

describe('EMOJI_CATALOG', () => {
  it('содержит записи только с валидными group id', () => {
    const validGroups = new Set(EMOJI_GROUPS.map((g) => g.id));
    for (const entry of EMOJI_CATALOG) {
      expect(validGroups.has(entry.group)).toBe(true);
    }
  });

  it('уникальность unicode среди базовых глифов', () => {
    const seen = new Set<string>();
    for (const entry of EMOJI_CATALOG) {
      expect(seen.has(entry.unicode)).toBe(false);
      seen.add(entry.unicode);
    }
  });

  it('каталог не пустой и содержит несколько сотен+ эмодзи', () => {
    expect(EMOJI_CATALOG.length).toBeGreaterThan(500);
  });
});

describe('isValidEmojiSequence', () => {
  it('принимает базовый эмодзи из каталога', () => {
    expect(isValidEmojiSequence(EMOJI_CATALOG[0]!.unicode)).toBe(true);
  });

  it('принимает вариант тона кожи из каталога', () => {
    const withSkins = EMOJI_CATALOG.find((e) => e.skins);
    expect(withSkins).toBeDefined();
    const variant = Object.values(withSkins!.skins!)[0]!;
    expect(isValidEmojiSequence(variant)).toBe(true);
  });

  it('отклоняет произвольную не-эмодзи строку', () => {
    expect(isValidEmojiSequence('not-an-emoji')).toBe(false);
    expect(isValidEmojiSequence('')).toBe(false);
    expect(isValidEmojiSequence(123)).toBe(false);
    expect(isValidEmojiSequence(null)).toBe(false);
  });

  it('принимает эмодзи как с VS16, так и без (U+FE0F)', () => {
    // 👍 в каталоге есть с VS16 — без него (как в старых тестах) тоже допустим
    expect(isValidEmojiSequence('👍')).toBe(true);
    expect(isValidEmojiSequence('👍️')).toBe(true);
  });
});
