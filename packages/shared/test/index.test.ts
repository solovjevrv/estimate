import { describe, expect, it } from 'vitest';

import { FIBONACCI_DECK, SCALE_0_5_DECK, TEAM_ROLES, WS_EVENTS, hasTeamRole } from '../src/index';

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
    expect(TEAM_ROLES).toEqual(['owner', 'admin', 'member', 'guest']);
  });

  it('старшая роль подходит там, где требуется младшая', () => {
    expect(hasTeamRole('owner', 'admin')).toBe(true);
    expect(hasTeamRole('admin', 'member')).toBe(true);
    expect(hasTeamRole('member', 'guest')).toBe(true);
  });

  it('младшая роль не подходит там, где требуется старшая', () => {
    expect(hasTeamRole('admin', 'owner')).toBe(false);
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
  it('колода Фибоначчи не пуста и отсортирована по возрастанию', () => {
    expect(FIBONACCI_DECK.length).toBeGreaterThan(0);
    expect([...FIBONACCI_DECK]).toEqual([...FIBONACCI_DECK].sort((a, b) => a - b));
  });

  it('шкала 0–5 содержит целые значения от 0 до 5', () => {
    expect(SCALE_0_5_DECK).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
