/** Команды пользователя: список, карточка с составом и работа с приглашениями. */
import type { Team, TeamMember, TeamMemberProfile, TeamRole, TeamWithRole } from '@estimate/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';

import {
  changeTeamMemberRole,
  createTeam,
  deleteTeam,
  getTeam,
  getTeamMember,
  joinInvite,
  listTeams,
  previewInvite,
  removeTeamMember,
  renameTeam,
  rotateTeamInvite,
  type TeamOverviewResponse,
} from '../features/teams/api/teams-api';

/** Карточка команды: состав, роль текущего пользователя и код приглашения. */
export interface TeamOverview {
  team: Team;
  role: TeamRole;
  members: TeamMember[];
  /** Код приходит только администратору; остальным — null */
  inviteCode: string | null;
}

export const useTeamsStore = defineStore('teams', () => {
  const list = ref<TeamWithRole[]>([]);
  const current = ref<TeamOverview | null>(null);

  async function loadList(): Promise<void> {
    list.value = await listTeams();
  }

  async function create(name: string): Promise<TeamWithRole> {
    const team = await createTeam(name);
    // Кладём новую команду в начало списка, чтобы не перезапрашивать его
    list.value = [team, ...list.value];
    return team;
  }

  async function loadTeam(id: string): Promise<TeamOverview> {
    const res: TeamOverviewResponse = await getTeam(id);
    const overview: TeamOverview = {
      team: res.team,
      role: res.role,
      members: res.members,
      inviteCode: res.inviteCode,
    };
    current.value = overview;
    return overview;
  }

  async function rotateInvite(id: string): Promise<string> {
    const inviteCode = await rotateTeamInvite(id);
    // Если открыта та же команда — сразу показываем новый код
    if (current.value && current.value.team.id === id) {
      current.value.inviteCode = inviteCode;
    }
    return inviteCode;
  }

  /** Предпросмотр открыт без входа: по коду видно, в какую команду зовут. */
  async function previewInviteCode(code: string): Promise<{ id: string; name: string }> {
    return previewInvite(code);
  }

  /** Идемпотентно: повторный переход по коду не меняет уже выданную роль. */
  async function joinByInvite(code: string): Promise<{ team: Team; role: TeamRole }> {
    return joinInvite(code);
  }

  /**
   * Сменить роль участника (только администратор). `actorRole` в ответе
   * меняется только когда админ меняет роль сам себе.
   */
  async function changeRole(
    teamId: string,
    userId: string,
    role: TeamRole,
  ): Promise<{ member: { userId: string; role: TeamRole }; actorRole: TeamRole }> {
    const res = await changeTeamMemberRole(teamId, userId, role);

    const cur = current.value;
    if (cur && cur.team.id === teamId) {
      cur.members = cur.members.map((m) =>
        m.userId === res.member.userId ? { ...m, role: res.member.role } : m,
      );
      cur.role = res.actorRole;
    }
    return res;
  }

  /** Исключить участника (администратор) или выйти самому (любой участник). */
  async function removeMember(teamId: string, userId: string): Promise<void> {
    await removeTeamMember(teamId, userId);
    const cur = current.value;
    if (cur && cur.team.id === teamId) {
      cur.members = cur.members.filter((m) => m.userId !== userId);
    }
  }

  /** Переименовать команду (только администратор). */
  async function rename(teamId: string, name: string): Promise<Team> {
    const team = await renameTeam(teamId, name);
    const cur = current.value;
    if (cur && cur.team.id === teamId) cur.team = team;
    list.value = list.value.map((t) => (t.id === teamId ? { ...t, name: team.name } : t));
    return team;
  }

  /** Карточка одного участника (10.14) — доступна только участникам той же команды. */
  async function loadMember(teamId: string, userId: string): Promise<TeamMemberProfile> {
    return getTeamMember(teamId, userId);
  }

  /** Удалить команду (только администратор). Комнаты команды на бэкенде сохраняются. */
  async function remove(teamId: string): Promise<void> {
    await deleteTeam(teamId);
    list.value = list.value.filter((t) => t.id !== teamId);
    if (current.value?.team.id === teamId) current.value = null;
  }

  return {
    list,
    current,
    loadList,
    create,
    loadTeam,
    loadMember,
    rotateInvite,
    previewInvite: previewInviteCode,
    joinByInvite,
    changeMemberRole: changeRole,
    removeMember,
    rename,
    remove,
  };
});
