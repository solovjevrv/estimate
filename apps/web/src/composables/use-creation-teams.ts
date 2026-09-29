import { hasTeamRole, type TeamRole } from '@estimate/shared';
import { computed, type ComputedRef } from 'vue';

import { useTeamsStore } from '../stores/teams';

export interface CreationTeam {
  id: string;
  name: string;
}

/**
 * Команды, в которых пользователь может создать комнату или доску (DS-063, окно
 * создания с переключателем «Командная»). Право совпадает с сервером: командную
 * комнату заводит администратор, доску — участник или администратор.
 */
export function useCreationTeams(required: TeamRole): {
  options: ComputedRef<CreationTeam[]>;
  ensureLoaded: () => Promise<void>;
} {
  const teams = useTeamsStore();

  const options = computed(() =>
    teams.list
      .filter((team) => hasTeamRole(team.role, required))
      .map((team) => ({ id: team.id, name: team.name })),
  );

  /**
   * Главная и страница команды список команд сами не грузят — подтягиваем его
   * перед открытием окна. Не загрузился — окно откроется без переключателя
   * (создание личной), а не упадёт.
   */
  async function ensureLoaded(): Promise<void> {
    try {
      await teams.loadList();
    } catch {
      // см. комментарий выше
    }
  }

  return { options, ensureLoaded };
}
