import { onMounted } from 'vue';

import type { MoveEntityKind } from '../lib/move-entity';
import { hasMoveTarget } from '../lib/move-entity';
import { useSessionStore } from '../stores/session';
import { useCreationTeams } from './use-creation-teams';

/**
 * Есть ли куда перенести комнату или доску (10.24) — пункт «Перенести…» в меню
 * показываем только тогда. Командную можно сделать личной, если владелец ещё
 * есть; в команду — только туда, где можно завести такое (как при создании).
 */
export function useMoveAvailability() {
  const roomTeams = useCreationTeams('admin');
  const boardTeams = useCreationTeams('member');

  const session = useSessionStore();

  // Список команд нужен меню сразу — страницы «Мои комнаты/доски» его сами не грузят.
  // Гостю (комната/доска по ссылке) переносить нечего — без запроса, иначе 401
  onMounted(() => {
    if (session.isAuthenticated) void roomTeams.ensureLoaded();
  });

  function canMove(kind: MoveEntityKind, teamId: string | null, ownerId: string | null): boolean {
    const teams = kind === 'room' ? roomTeams.options.value : boardTeams.options.value;
    return hasMoveTarget(teamId, ownerId, teams);
  }

  return { canMove };
}
