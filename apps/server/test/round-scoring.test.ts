import { describe, expect, it } from 'vitest';

import { calculateAgreement, summarizeRound, type ScoredVote } from '../src/rooms/round-scoring';

function vote(overrides: Partial<ScoredVote> = {}): ScoredVote {
  return { participantId: 'p1', name: 'Участник', value: 3, ...overrides };
}

describe('calculateAgreement', () => {
  it('считает единогласие и расхождение голосов', () => {
    expect(calculateAgreement([5, 5, 5])).toBe(100);
    expect(calculateAgreement([3, 5, 8])).toBe(33);
  });

  it('при ничьей берёт размер любой максимальной группы', () => {
    expect(calculateAgreement([3, 3, 5, 5])).toBe(50);
  });
});

describe('summarizeRound', () => {
  it('считает округлённое среднее, границы, согласие и сохраняет порядок голосов', () => {
    const result = summarizeRound(
      [vote({ participantId: 'p2', name: null, value: 3 }), vote({ value: 8 })],
      'fibonacci',
    );

    expect(result).toEqual({
      average: 5.5,
      min: 3,
      max: 8,
      agreement: 50,
      votes: [
        { participantId: 'p2', name: 'Участник', value: 3 },
        { participantId: 'p1', name: 'Участник', value: 8 },
      ],
    });
  });

  it('округляет среднее до двух знаков и уважает уже сохранённое значение', () => {
    const votes = [
      vote({ value: 1 }),
      vote({ participantId: 'p2', value: 2 }),
      vote({ participantId: 'p3', value: 2 }),
    ];

    expect(summarizeRound(votes, 'fibonacci').average).toBe(1.67);
    expect(summarizeRound(votes, 'fibonacci', 1.5).average).toBe(1.5);
  });

  it('для футболочной колоды никогда не возвращает среднее', () => {
    expect(
      summarizeRound([vote({ value: 1 }), vote({ participantId: 'p2', value: 3 })], 'tshirt', 2)
        .average,
    ).toBeNull();
  });
});
