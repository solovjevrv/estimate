import type { Board } from '@poker/shared';
import { describe, expect, it } from 'vitest';

import {
  hasRequiredBoardAccess,
  resolveBoardAccess,
  resolveMembershipBoardAccess,
} from '../src/boards/boards.policy';

const TEAM_BOARD: Pick<Board, 'teamId' | 'ownerId'> = { teamId: 'team-1', ownerId: 'owner' };

describe('resolveMembershipBoardAccess', () => {
  it('различает владельца, роли команды и постороннего', () => {
    expect(resolveMembershipBoardAccess(TEAM_BOARD, 'owner', 'guest')).toBe('manage');
    expect(resolveMembershipBoardAccess(TEAM_BOARD, 'admin', 'admin')).toBe('manage');
    expect(resolveMembershipBoardAccess(TEAM_BOARD, 'member', 'member')).toBe('edit');
    expect(resolveMembershipBoardAccess(TEAM_BOARD, 'guest', 'guest')).toBe('view');
    expect(resolveMembershipBoardAccess(TEAM_BOARD, 'stranger', null)).toBeNull();
  });

  it('даёт manage только владельцу личной доски', () => {
    const personal: Pick<Board, 'teamId' | 'ownerId'> = { teamId: null, ownerId: 'owner' };

    expect(resolveMembershipBoardAccess(personal, 'owner', null)).toBe('manage');
    expect(resolveMembershipBoardAccess(personal, 'stranger', null)).toBeNull();
  });
});

describe('resolveBoardAccess', () => {
  it('выбирает более высокий из доступа по команде и по ссылке', () => {
    expect(resolveBoardAccess('edit', 'view')).toBe('edit');
    expect(resolveBoardAccess('view', 'edit')).toBe('edit');
    expect(resolveBoardAccess(null, 'view')).toBe('view');
  });

  it('проверяет требуемый уровень уже после объединения источников доступа', () => {
    expect(hasRequiredBoardAccess('view', 'edit', 'edit')).toBe(true);
    expect(hasRequiredBoardAccess('view', null, 'edit')).toBe(false);
  });
});
