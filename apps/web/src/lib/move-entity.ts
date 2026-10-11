/**
 * Перенос комнаты или доски (10.24): куда можно перенести. В команду — по
 * правилу создания (комнату — админ, доску — участник; список таких команд
 * даёт `useCreationTeams`), личной — всегда, если объект сейчас командный.
 * Текущее место в списке не показывается.
 */
import type { Board, Room } from '@estimate/shared';

export type MoveEntityKind = 'room' | 'board';

/** Что переносим: страница открывает окно, отдавая его в `v-model:request` */
export interface MoveRequest {
  kind: MoveEntityKind;
  id: string;
  name: string;
  teamId: string | null;
  /** Создатель комнаты / владелец доски — у него объект станет личным */
  ownerId: string | null;
}

export function roomMoveRequest(room: Room): MoveRequest {
  return {
    kind: 'room',
    id: room.id,
    name: room.name,
    teamId: room.teamId,
    ownerId: room.creatorId,
  };
}

export function boardMoveRequest(board: Board): MoveRequest {
  return {
    kind: 'board',
    id: board.id,
    name: board.title,
    teamId: board.teamId,
    ownerId: board.ownerId,
  };
}

export interface MoveTarget {
  /** null — сделать личной */
  teamId: string | null;
  label: string;
}

export function moveTargets(
  currentTeamId: string | null,
  creationTeams: readonly { id: string; name: string }[],
  personalLabel: string,
): MoveTarget[] {
  const targets: MoveTarget[] = currentTeamId ? [{ teamId: null, label: personalLabel }] : [];
  for (const team of creationTeams) {
    if (team.id !== currentTeamId) targets.push({ teamId: team.id, label: team.name });
  }
  return targets;
}

/**
 * Есть ли куда перенести: в другую команду, где можно завести такое, или
 * сделать личной — если владелец ещё есть (иначе отдать некому)
 */
export function hasMoveTarget(
  currentTeamId: string | null,
  ownerId: string | null,
  creationTeams: readonly { id: string; name: string }[],
): boolean {
  return moveTargets(currentTeamId, creationTeams, '').some(
    (target) => target.teamId !== null || ownerId !== null,
  );
}
