/** Команды пользователя: список, карточка с составом и работа с приглашениями. */
import type { Team, TeamMember, TeamMemberProfile, TeamRole, TeamWithRole } from '@estimate/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { api } from '../lib/api';

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
    const res = await api.get<{ teams: TeamWithRole[] }>('/api/teams');
    list.value = res.teams;
  }

  async function create(name: string): Promise<TeamWithRole> {
    const res = await api.post<{ team: TeamWithRole }>('/api/teams', { name });
    // Кладём новую команду в начало списка, чтобы не перезапрашивать его
    list.value = [res.team, ...list.value];
    return res.team;
  }

  async function loadTeam(id: string): Promise<TeamOverview> {
    const res = await api.get<{
      team: Team;
      role: TeamRole;
      members: TeamMember[];
      inviteCode?: string;
    }>(`/api/teams/${encodeURIComponent(id)}`);
    const overview: TeamOverview = {
      team: res.team,
      role: res.role,
      members: res.members,
      inviteCode: res.inviteCode ?? null,
    };
    current.value = overview;
    return overview;
  }

  async function rotateInvite(id: string): Promise<string> {
    const res = await api.post<{ inviteCode: string }>(
      `/api/teams/${encodeURIComponent(id)}/invite/rotate`,
    );
    // Если открыта та же команда — сразу показываем новый код
    if (current.value && current.value.team.id === id) {
      current.value.inviteCode = res.inviteCode;
    }
    return res.inviteCode;
  }

  /** Предпросмотр открыт без входа: по коду видно, в какую команду зовут. */
  async function previewInvite(code: string): Promise<{ id: string; name: string }> {
    const res = await api.get<{ team: { id: string; name: string } }>(
      `/api/invites/${encodeURIComponent(code)}`,
    );
    return res.team;
  }

  /** Идемпотентно: повторный переход по коду не меняет уже выданную роль. */
  async function joinByInvite(code: string): Promise<{ team: Team; role: TeamRole }> {
    return api.post<{ team: Team; role: TeamRole }>(
      `/api/invites/${encodeURIComponent(code)}/join`,
    );
  }

  /**
   * Сменить роль участника (только администратор). `actorRole` в ответе
   * меняется только когда админ меняет роль сам себе.
   */
  async function changeMemberRole(
    teamId: string,
    userId: string,
    role: TeamRole,
  ): Promise<{ member: { userId: string; role: TeamRole }; actorRole: TeamRole }> {
    const res = await api.patch<{
      member: { userId: string; role: TeamRole };
      actorRole: TeamRole;
    }>(`/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, { role });

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
    await api.delete(
      `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    );
    const cur = current.value;
    if (cur && cur.team.id === teamId) {
      cur.members = cur.members.filter((m) => m.userId !== userId);
    }
  }

  /** Переименовать команду (только администратор). */
  async function rename(teamId: string, name: string): Promise<Team> {
    const res = await api.patch<{ team: Team }>(`/api/teams/${encodeURIComponent(teamId)}`, {
      name,
    });
    const cur = current.value;
    if (cur && cur.team.id === teamId) cur.team = res.team;
    list.value = list.value.map((t) => (t.id === teamId ? { ...t, name: res.team.name } : t));
    return res.team;
  }

  /** Карточка одного участника (10.14) — доступна только участникам той же команды. */
  async function loadMember(teamId: string, userId: string): Promise<TeamMemberProfile> {
    const res = await api.get<{ member: TeamMemberProfile }>(
      `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    );
    return res.member;
  }

  /** Удалить команду (только администратор). Комнаты команды на бэкенде сохраняются. */
  async function remove(teamId: string): Promise<void> {
    await api.delete(`/api/teams/${encodeURIComponent(teamId)}`);
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
    previewInvite,
    joinByInvite,
    changeMemberRole,
    removeMember,
    rename,
    remove,
  };
});
