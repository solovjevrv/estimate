import { describe, expect, it } from 'vitest';

import { FIBONACCI_DECK, SCALE_0_5_DECK, WS_EVENTS } from '../src/index';

describe('контракты WS-событий', () => {
  it('содержат все события из скоупа Epic 2', () => {
    expect(Object.values(WS_EVENTS)).toEqual(
      expect.arrayContaining([
        'join_room',
        'submit_vote',
        'reveal_cards',
        'start_new_round',
        'update_links',
      ]),
    );
  });
});

describe('колоды', () => {
  it('колода Фибоначчи не пуста и отсортирована по возрастанию', () => {
    expect(FIBONACCI_DECK.length).toBeGreaterThan(0);
    expect([...FIBONACCI_DECK]).toEqual([...FIBONACCI_DECK].sort((a, b) => a - b));
  });

  it('шкала 0–5 содержит целые значения от 0 до 5', () => {
    expect(SCALE_0_5_DECK).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
