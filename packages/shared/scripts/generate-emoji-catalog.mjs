/**
 * Генератор каталога emoji (21.4).
 *
 * Запуск: pnpm --filter @poker/shared generate:emoji
 *
 * Собирает EMOJI_CATALOG из открытого датасета emojibase-data:
 * - packages/shared/node_modules/emojibase-data/en/data.json  (английские метки + теги)
 * - packages/shared/node_modules/emojibase-data/ru/data.json  (русские метки + теги)
 * - packages/shared/node_modules/emojibase-data/en/shortcodes/emojibase.json (shortcodes)
 *
 * Сопоставление записей между локалями и shortcodes — по полю `hexcode`
 * (стабильный ID в emojibase, одинаковый для всех локалей).
 *
 * Выбран пресет shortcodes `emojibase.json` — каноничный набор от создателей
 * emojibase (наиболее полный и стабильный). Если в будущем понадобится другой
 * пресет (например, `iamcal.json`), достаточно поменять имя файла ниже.
 *
 * Результат — packages/shared/src/emoji/catalog.generated.ts (коммитится в git,
 * не генерируется на CI): детерминированный, читаемый diff, без сетевых
 * обращений при сборке/Docker.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import enData from 'emojibase-data/en/data.json' with { type: 'json' };
import ruData from 'emojibase-data/ru/data.json' with { type: 'json' };
import shortcodes from 'emojibase-data/en/shortcodes/emojibase.json' with { type: 'json' };

// --- Карта групп emojibase → EmojiGroupId ----------------------------------------
// Значения group в emojibase-data — числа 0..9. Соответствие (из meta/groups.json):
//   0 → smileys-emotion, 1 → people-body, 2 → component (модификаторы тона кожи),
//   3 → animals-nature, 4 → food-drink, 5 → travel-places, 6 → activities,
//   7 → objects, 8 → symbols, 9 → flags
// Группа 2 (component) — это служебные модификаторы тона кожи (🏻🏼🏽🏾🏿) и
// компоненты волос/бороды — их исключаем из пикера.
// Записи без поля `group` (regional indicator A–Z, 26 штук) тоже исключаем.
const GROUP_ID_MAP = {
  0: 'smileys-emotion',
  1: 'people-body',
  2: null, // component
  3: 'animals-nature',
  4: 'food-drink',
  5: 'travel-places',
  6: 'activities',
  7: 'objects',
  8: 'symbols',
  9: 'flags',
};

// --- Карта тонов кожи -----------------------------------------------------------
// tone: 1=light, 2=medium-light, 3=medium, 4=medium-dark, 5=dark
const TONE_MAP = {
  1: 'light',
  2: 'medium-light',
  3: 'medium',
  4: 'medium-dark',
  5: 'dark',
};

// Индекс ru-записей по hexcode для быстрого сопоставления
const ruByHexcode = new Map();
for (const entry of ruData) {
  ruByHexcode.set(entry.hexcode, entry);
}

function normalizeShortcodes(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((s) => s.replace(/^:/, '').replace(/:$/, '')).filter(Boolean);
}

function buildEntry(enEntry) {
  const group = GROUP_ID_MAP[enEntry.group];
  if (!group) return null;

  let skins = null;
  if (enEntry.skins) {
    // Только однотонные варианты (5 штук: light, medium-light, medium, medium-dark, dark)
    // Комбинации из двух разных тонов (для парных эмодзи) — не включаются в skins
    // (осознанное сужение объёма задачы, заложено планом 21.4)
    skins = {};
    for (const skin of enEntry.skins) {
      const toneId = TONE_MAP[skin.tone];
      if (toneId && !skins[toneId]) {
        skins[toneId] = skin.emoji;
      }
    }
    const hasAny = Object.values(skins).some(Boolean);
    if (!hasAny) {
      skins = null;
    }
  }

  const tagsEn = [...(enEntry.tags ?? []), enEntry.label.toLowerCase()];
  const ruEntry = ruByHexcode.get(enEntry.hexcode);
  const tagsRu = ruEntry ? [...(ruEntry.tags ?? []), ruEntry.label.toLowerCase()] : [];

  const codes = shortcodes[enEntry.hexcode];

  return {
    unicode: enEntry.emoji,
    group,
    order: enEntry.order,
    label: enEntry.label,
    tagsEn: [...new Set(tagsEn)],
    tagsRu: [...new Set(tagsRu)],
    shortcodes: normalizeShortcodes(codes),
    ...(skins && Object.keys(skins).length > 0 ? { skins } : {}),
  };
}

function main() {
  const entries = [];
  const groupExample = {};

  for (const enEntry of enData) {
    const groupVal = enEntry.group;
    const groupKey = groupVal !== undefined ? String(groupVal) : 'undefined';
    if (!groupExample[groupKey]) {
      console.log(`Группа ${groupKey}: пример записи:`, JSON.stringify(enEntry, null, 2));
      groupExample[groupKey] = enEntry;
    }
    const entry = buildEntry(enEntry);
    if (entry) entries.push(entry);
  }

  // Сортировка: по порядку групп в EMOJI_GROUPS, затем по order
  const groupOrder = new Map(
    [
      'smileys-emotion',
      'people-body',
      'animals-nature',
      'food-drink',
      'travel-places',
      'activities',
      'objects',
      'symbols',
      'flags',
    ].map((id, i) => [id, i]),
  );
  entries.sort((a, b) => {
    const ga = groupOrder.get(a.group);
    const gb = groupOrder.get(b.group);
    if (ga !== gb) return ga - gb;
    return a.order - b.order;
  });

  // Считаем статистику
  const withSkins = entries.filter((e) => e.skins);
  const groupCounts = {};
  for (const e of entries) {
    groupCounts[e.group] = (groupCounts[e.group] ?? 0) + 1;
  }
  const withoutTagsRu = entries.filter((e) => e.tagsRu.length === 0);

  const lines = [];
  lines.push('// СГЕНЕРИРОВАНО — не редактировать руками.');
  lines.push('// Пересобрать: pnpm --filter @poker/shared generate:emoji');
  lines.push('// Источник: emojibase-data@17.0.0, shortcodes preset: emojibase.json');
  lines.push("import type { EmojiCatalogEntry } from './index';");
  lines.push('');
  lines.push('export const EMOJI_CATALOG: readonly EmojiCatalogEntry[] = [');

  for (const entry of entries) {
    const objLines = [];
    objLines.push(`unicode: ${JSON.stringify(entry.unicode)},`);
    objLines.push(`group: ${JSON.stringify(entry.group)},`);
    objLines.push(`order: ${entry.order},`);
    objLines.push(`label: ${JSON.stringify(entry.label)},`);
    objLines.push(`tagsEn: ${JSON.stringify(entry.tagsEn)},`);
    objLines.push(`tagsRu: ${JSON.stringify(entry.tagsRu)},`);
    objLines.push(`shortcodes: ${JSON.stringify(entry.shortcodes)},`);
    if (entry.skins) {
      const skinEntries = Object.entries(entry.skins).filter(([, v]) => !!v);
      if (skinEntries.length > 0) {
        const skinStr = skinEntries
          .map(([toneId, val]) => `    ${JSON.stringify(toneId)}: ${JSON.stringify(val)},`)
          .join('\n');
        objLines.push(`skins: {\n${skinStr}\n  },`);
      }
    }
    lines.push('  {');
    lines.push(`    ${objLines.join('\n    ')}`);
    lines.push('  } as EmojiCatalogEntry,');
  }

  lines.push('];');

  const output = lines.join('\n') + '\n';
  const outputPath = resolve(import.meta.dirname, '../src/emoji/catalog.generated.ts');
  writeFileSync(outputPath, output, 'utf-8');

  console.log('\n=== Сводka ===');
  console.log(`Всего эмодзи в каталоге: ${entries.length}`);
  console.log(`С skins: ${withSkins.length}`);
  console.log('По группам:');
  for (const [g, count] of Object.entries(groupCounts)) {
    console.log(`  ${g}: ${count}`);
  }
  console.log(`Записей без tagsRu: ${withoutTagsRu.length}`);
  console.log(`Файл записан: ${outputPath}`);
}

main();
