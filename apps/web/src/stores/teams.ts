/** Команды пользователя: список, карточка с составом и работа с приглашениями. */
import type { Team, TeamMember, TeamRole, TeamWithRole } from '@poker/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { api } from '../lib/api';

/** Карточка команды: состав, роль текущего пользователя и код приглашения. */
export interface TeamOverview {
  team: Team;
  role: TeamRole;
  members: TeamMember[];
  /** Код приходит только админу и владельцу; остальным — null */
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

  return { list, current, loadList, create, loadTeam, rotateInvite, previewInvite, joinByInvite };
});
