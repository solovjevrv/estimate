import { EMOJI_CATALOG } from './catalog.generated';
import type { EmojiSequence } from './index';

/**
 * U+FE0F (VARIATION SELECTOR-16) — презентационный селектор, семантически
 * не меняет эмодзи. Клиенты и библиотеки иногда опускают его, поэтому валидатор
 * принимает обе формы: с VS16 (как в каталоге) и без.
 */
function stripVariationSelector(s: string): string {
  return s.replace(/\uFE0F/g, '');
}

function collectValidSequences(): ReadonlySet<string> {
  const set = new Set<string>();
  for (const entry of EMOJI_CATALOG) {
    set.add(entry.unicode);
    set.add(stripVariationSelector(entry.unicode));
    if (entry.skins) {
      for (const variant of Object.values(entry.skins)) {
        if (variant) {
          set.add(variant);
          set.add(stripVariationSelector(variant));
        }
      }
    }
  }
  return set;
}

const VALID_EMOJI_SEQUENCES = collectValidSequences();

export function isValidEmojiSequence(candidate: unknown): candidate is EmojiSequence {
  if (typeof candidate !== 'string') return false;
  return (
    VALID_EMOJI_SEQUENCES.has(candidate) ||
    VALID_EMOJI_SEQUENCES.has(stripVariationSelector(candidate))
  );
}
