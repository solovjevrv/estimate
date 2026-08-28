import type { DeckType, RoundResult } from '@estimate/shared';

/** Минимальные данные голоса, нужные чистому подсчёту итогов раунда. */
export interface ScoredVote {
  participantId: string;
  name: string | null;
  value: number;
}

/** Доля голосов за самое частое значение, округлённая до целого процента. */
export function calculateAgreement(values: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  return Math.round((maxCount / values.length) * 100);
}

/**
 * Строит итог вскрытого раунда без обращения к БД или состоянию комнаты.
 *
 * Пустой список не является допустимым входом: revealCards проверяет его до
 * вызова, а история отфильтровывает раунды без сохранившихся голосов. Не
 * добавляем здесь новое поведение исключения, чтобы не менять контракт
 * существующего I/O-слоя.
 */
export function summarizeRound(
  votes: readonly ScoredVote[],
  deckType: DeckType,
  storedAverage: number | null = null,
): RoundResult {
  const values = votes.map((vote) => vote.value);
  const sum = values.reduce((total, value) => total + value, 0);
  // Для футболочных размеров среднее числового веса не несёт смысла — не считаем.
  const average =
    deckType === 'tshirt' ? null : (storedAverage ?? Math.round((sum / values.length) * 100) / 100);

  return {
    average,
    min: Math.min(...values),
    max: Math.max(...values),
    agreement: calculateAgreement(values),
    votes: votes.map((vote) => ({
      participantId: vote.participantId,
      name: vote.name ?? 'Участник',
      value: vote.value,
    })),
  };
}
