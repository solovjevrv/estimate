/** REST-слой команд: единственное место, знающее URL `/api/teams`, `/api/invites` и коды ответов. */
import type {
  BoardSummary,
  Room,
  Team,
  TeamMember,
  TeamMemberProfile,
  TeamRole,
  TeamWithRole,
} from '@estimate/shared';
import { api } from '../../../lib/api';

/** Карточка команды: состав, роль текущего пользователя и код приглашения. */
export interface TeamOverviewResponse {
  team: Team;
  role: TeamRole;
  members: TeamMember[];
  /** Нормализуется здесь из отсутствующего поля в `null` (а не в сторе команд) */
  inviteCode: string | null;
}

export function listTeams(): Promise<TeamWithRole[]> {
  return api.get<{ teams: TeamWithRole[] }>('/api/teams').then((res) => res.teams);
}

export function createTeam(name: string): Promise<TeamWithRole> {
  return api.post<{ team: TeamWithRole }>('/api/teams', { name }).then((res) => res.team);
}

export function getTeam(teamId: string): Promise<TeamOverviewResponse> {
  return api
    .get<{
      team: Team;
      role: TeamRole;
      members: TeamMember[];
      inviteCode?: string;
    }>(`/api/teams/${encodeURIComponent(teamId)}`)
    .then((res) => ({
      team: res.team,
      role: res.role,
      members: res.members,
      inviteCode: res.inviteCode ?? null,
    }));
}

export function renameTeam(teamId: string, name: string): Promise<Team> {
  return api
    .patch<{ team: Team }>(`/api/teams/${encodeURIComponent(teamId)}`, { name })
    .then((res) => res.team);
}

export function deleteTeam(teamId: string): Promise<void> {
  return api.delete(`/api/teams/${encodeURIComponent(teamId)}`);
}

export function rotateTeamInvite(teamId: string): Promise<string> {
  return api
    .post<{ inviteCode: string }>(`/api/teams/${encodeURIComponent(teamId)}/invite/rotate`)
    .then((res) => res.inviteCode);
}

/** Предпросмотр открыт без входа: по коду видно, в какую команду зовут. */
export function previewInvite(code: string): Promise<{ id: string; name: string }> {
  return api
    .get<{ team: { id: string; name: string } }>(`/api/invites/${encodeURIComponent(code)}`)
    .then((res) => res.team);
}

export function joinInvite(code: string): Promise<{ team: Team; role: TeamRole }> {
  return api.post<{ team: Team; role: TeamRole }>(`/api/invites/${encodeURIComponent(code)}/join`);
}

export function changeTeamMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole,
): Promise<{ member: { userId: string; role: TeamRole }; actorRole: TeamRole }> {
  return api.patch<{ member: { userId: string; role: TeamRole }; actorRole: TeamRole }>(
    `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    { role },
  );
}

export function removeTeamMember(teamId: string, userId: string): Promise<void> {
  return api.delete(
    `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
  );
}

export function getTeamMember(teamId: string, userId: string): Promise<TeamMemberProfile> {
  return api
    .get<{ member: TeamMemberProfile }>(
      `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    )
    .then((res) => res.member);
}

export function listTeamRooms(teamId: string, archived = false): Promise<Room[]> {
  const suffix = archived ? '?archived=true' : '';
  return api
    .get<{ rooms: Room[] }>(`/api/teams/${encodeURIComponent(teamId)}/rooms${suffix}`)
    .then((res) => res.rooms);
}

export function listTeamBoards(teamId: string, archived = false): Promise<BoardSummary[]> {
  const suffix = archived ? '?archived=true' : '';
  return api
    .get<{ boards: BoardSummary[] }>(`/api/teams/${encodeURIComponent(teamId)}/boards${suffix}`)
    .then((res) => res.boards);
}
