import { hasTeamRole, type RoomRole, type TeamRole } from '@estimate/shared';

/**
 * Роль участника в комнате по уже прочитанным данным о владельце и членстве.
 * Запрос к команде намеренно остаётся снаружи: правило не зависит от БД.
 */
export function resolveRoomRole(
  creatorId: string | null,
  actorId: string | null,
  teamRole: TeamRole | null,
): RoomRole {
  if (
    (actorId !== null && actorId === creatorId) ||
    (teamRole !== null && hasTeamRole(teamRole, 'admin'))
  ) {
    return 'scrum_master';
  }
  return 'voter';
}
