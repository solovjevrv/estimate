import { describe, expect, it } from 'vitest';

import {
  DECK_CARDS,
  FIBONACCI_DECK,
  SCALE_0_5_DECK,
  TEAM_ROLES,
  TSHIRT_DECK,
  WS_EVENTS,
  hasTeamRole,
  tshirtLabel,
} from '../src/index';

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

describe('ролевая модель команды', () => {
  it('роли перечислены от старшей к младшей', () => {
    expect(TEAM_ROLES).toEqual(['admin', 'member', 'guest']);
  });

  it('старшая роль подходит там, где требуется младшая', () => {
    expect(hasTeamRole('admin', 'member')).toBe(true);
    expect(hasTeamRole('member', 'guest')).toBe(true);
  });

  it('младшая роль не подходит там, где требуется старшая', () => {
    expect(hasTeamRole('member', 'admin')).toBe(false);
    expect(hasTeamRole('guest', 'member')).toBe(false);
  });

  it('роль всегда достаточна сама для себя', () => {
    for (const role of TEAM_ROLES) {
      expect(hasTeamRole(role, role)).toBe(true);
    }
  });
});

describe('колоды', () => {
  it('колода Фибоначчи не пуста, отсортирована по возрастанию и доходит до 233', () => {
    expect(FIBONACCI_DECK.length).toBeGreaterThan(0);
    expect([...FIBONACCI_DECK]).toEqual([...FIBONACCI_DECK].sort((a, b) => a - b));
    expect(FIBONACCI_DECK[FIBONACCI_DECK.length - 1]).toBe(233);
  });

  it('шкала 0–5 содержит целые значения от 0 до 5', () => {
    expect(SCALE_0_5_DECK).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('футболочные размеры мапятся на числа один к одному', () => {
    expect(TSHIRT_DECK).toEqual([1, 2, 3, 5, 8, 13]);
    expect(tshirtLabel(1)).toBe('XS');
    expect(tshirtLabel(13)).toBe('XXL');
  });

  it('число вне колоды возвращает само себя как подпись', () => {
    expect(tshirtLabel(999)).toBe('999');
  });

  it('DECK_CARDS содержит колоду для каждого типа', () => {
    expect(DECK_CARDS.fibonacci).toBe(FIBONACCI_DECK);
    expect(DECK_CARDS.scale_0_5).toBe(SCALE_0_5_DECK);
    expect(DECK_CARDS.tshirt).toBe(TSHIRT_DECK);
  });
});
