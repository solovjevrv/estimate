import {
  hasBoardAccess,
  hasTeamRole,
  type Board,
  type BoardAccessLevel,
  type BoardShareRole,
  type TeamRole,
} from '@poker/shared';

/** Уровень доступа, который даёт владение личной доской или членство в её команде. */
export function resolveMembershipBoardAccess(
  board: Pick<Board, 'teamId' | 'ownerId'>,
  actorId: string | null,
  teamRole: TeamRole | null,
): BoardAccessLevel | null {
  if (!actorId) return null;
  if (!board.teamId) return board.ownerId === actorId ? 'manage' : null;
  if (!teamRole) return null;
  if (board.ownerId === actorId || hasTeamRole(teamRole, 'admin')) return 'manage';
  if (hasTeamRole(teamRole, 'member')) return 'edit';
  return 'view';
}

/** Более высокий из доступа по членству и доступа по публичной ссылке. */
export function resolveBoardAccess(
  membershipAccess: BoardAccessLevel | null,
  shareRole: BoardShareRole | null,
): BoardAccessLevel | null {
  if (membershipAccess && (!shareRole || hasBoardAccess(membershipAccess, shareRole))) {
    return membershipAccess;
  }
  return shareRole ?? membershipAccess;
}

export function hasRequiredBoardAccess(
  membershipAccess: BoardAccessLevel | null,
  shareRole: BoardShareRole | null,
  required: BoardAccessLevel,
): boolean {
  const access = resolveBoardAccess(membershipAccess, shareRole);
  return access !== null && hasBoardAccess(access, required);
}
