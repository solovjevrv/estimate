/**
 * Паритет локалей (19.7). Часть проблемы уже закрыта типами: `messages` в
 * `i18n/index.ts` объявлен как `Record<Locale, MessageSchema>`, где схема —
 * это `typeof ru`, поэтому ПРОПУЩЕННЫЙ в английском ключ не проходит
 * `pnpm typecheck`.
 *
 * Типы не ловят три вещи, и ровно они проверяются здесь:
 *   1. лишний ключ в `en` — структурная типизация допускает свойства сверх
 *      схемы, такой ключ просто становится мёртвым переводом;
 *   2. расхождение плейсхолдеров (`{max}`, `{count}` и т.п.) — для типов это
 *      обычная строка, а на экране пользователь увидит «не больше {max}»;
 *   3. пустое значение — ключ формально есть, но текста нет.
 */
import { describe, expect, it } from 'vitest';

import en from '../src/i18n/locales/en';
import ru from '../src/i18n/locales/ru';

type Messages = Record<string, unknown>;

/** Разворачивает вложенные объекты в плоскую карту `a.b.c` → строка */
function flatten(source: Messages, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result.set(path, value);
    } else if (value && typeof value === 'object') {
      for (const [nested, text] of flatten(value as Messages, path)) {
        result.set(nested, text);
      }
    }
  }
  return result;
}

/** Имена плейсхолдеров vue-i18n: `{name}`. Набор, а не список — порядок в переводе меняется */
function placeholders(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(/\{(\w+)\}/g), (match) => match[1]!));
}

const ruFlat = flatten(ru as Messages);
const enFlat = flatten(en as Messages);

describe('паритет локалей ru/en', () => {
  it('наборы ключей совпадают', () => {
    const onlyInRu = [...ruFlat.keys()].filter((key) => !enFlat.has(key));
    const onlyInEn = [...enFlat.keys()].filter((key) => !ruFlat.has(key));

    expect({ onlyInRu, onlyInEn }).toEqual({ onlyInRu: [], onlyInEn: [] });
  });

  it('ни один перевод не пуст', () => {
    const empty = [...ruFlat, ...enFlat]
      .filter(([, text]) => text.trim().length === 0)
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  it('плейсхолдеры совпадают в обеих локалях', () => {
    // Пропущенный в переводе плейсхолдер типами не ловится, а на экране
    // показывается как есть — «не длиннее {max} символов»
    const mismatched = [...ruFlat]
      .filter(([key, text]) => {
        const counterpart = enFlat.get(key);
        if (counterpart === undefined) return false; // отсутствие ключа проверяет тест выше
        const inRu = placeholders(text);
        const inEn = placeholders(counterpart);
        return inRu.size !== inEn.size || [...inRu].some((name) => !inEn.has(name));
      })
      .map(([key, text]) => ({ key, ru: text, en: enFlat.get(key) }));

    expect(mismatched).toEqual([]);
  });

  it('локали действительно непустые — тест не проходит вхолостую', () => {
    // Страховка от опечатки в самом тесте: если flatten однажды вернёт пусто,
    // все проверки выше станут зелёными, ничего не проверяя
    expect(ruFlat.size).toBeGreaterThan(400);
    expect(enFlat.size).toBe(ruFlat.size);
  });
});
