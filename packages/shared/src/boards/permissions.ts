/** Общие типы и контракты, используемые фронтендом и бэкендом. */

/** Уровень доступа к ссылке — то, что может выдать владелец. 'manage' по ссылке не бывает. */
export type BoardShareRole = 'view' | 'edit';
export const BOARD_SHARE_ROLES: readonly BoardShareRole[] = ['view', 'edit'];

/** Итоговый уровень доступа конкретного вызывающего к конкретной доске */
export type BoardAccessLevel = 'view' | 'edit' | 'manage';

const BOARD_ACCESS_WEIGHT: Record<BoardAccessLevel, number> = { manage: 0, edit: 1, view: 2 };

/** По образцу hasTeamRole — level даёт доступ не ниже required */
export function hasBoardAccess(level: BoardAccessLevel, required: BoardAccessLevel): boolean {
  return BOARD_ACCESS_WEIGHT[level] <= BOARD_ACCESS_WEIGHT[required];
}
