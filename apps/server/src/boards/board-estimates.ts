import { DECK_CARDS, ROOM_NAME_MAX_LENGTH, tshirtLabel, type DeckType } from '@estimate/shared';

/**
 * Подпись оценки элемента доски по вскрытому раунду (15.6): среднее —
 * к ближайшей карте колоды, у футболок среднего нет — самый частый размер.
 * При равенстве берётся большая карта: недооценить хуже, чем переоценить.
 * null — голосов нет, показывать нечего.
 */
export function estimateLabel(
  deckType: DeckType,
  average: number | null,
  values: readonly number[],
): string | null {
  if (deckType === 'tshirt') {
    const counts = new Map<number, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    let best: number | null = null;
    let bestCount = 0;
    for (const [value, count] of counts) {
      if (count > bestCount || (count === bestCount && best !== null && value > best)) {
        best = value;
        bestCount = count;
      }
    }
    return best === null ? null : tshirtLabel(best);
  }

  const mean =
    average ??
    (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  if (mean === null) return null;
  let nearest: number | null = null;
  for (const card of DECK_CARDS[deckType]) {
    if (
      nearest === null ||
      Math.abs(card - mean) < Math.abs(nearest - mean) ||
      (Math.abs(card - mean) === Math.abs(nearest - mean) && card > nearest)
    ) {
      nearest = card;
    }
  }
  return nearest === null ? null : String(nearest);
}

/** Название комнаты из текста элемента: одной строкой, в пределах лимита комнаты */
export function estimateRoomName(text: string, fallback: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return fallback;
  const chars = Array.from(line);
  return chars.length <= ROOM_NAME_MAX_LENGTH
    ? line
    : `${chars
        .slice(0, ROOM_NAME_MAX_LENGTH - 1)
        .join('')
        .trimEnd()}…`;
}
