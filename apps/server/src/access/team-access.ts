import { hasTeamRole, type TeamRole } from '@poker/shared';

import type { DbExecutor } from '../common/db-executor';
import { ForbiddenError, NotFoundError } from '../errors';
import { type Membership, TeamsRepository } from '../teams/teams.repository';

export type { Membership };

/**
 * Единственное место, где членство в команде превращается в право что-то
 * сделать.
 *
 * До 19.10 эта развилка была скопирована в трёх сервисах: комнаты, доски и сами
 * команды по-своему повторяли «нет членства — 404, роль ниже требуемой — 403».
 * При добавлении роли или изменении правила пришлось бы найти все копии, и
 * пропущенная означала бы не косметический баг, а дырку в доступе.
 *
 * Заодно это явный порт в домен команд: комнатам и доскам больше не нужен
 * `TeamsRepository`, они спрашивают о правах, а не читают чужую таблицу.
 */

/**
 * Чужая и несуществующая команда отвечают одинаково: иначе по коду ответа можно
 * было бы перебором узнать, какие команды существуют.
 */
const TEAM_NOT_FOUND = 'Команда не найдена';

const NOT_ENOUGH_RIGHTS = 'Недостаточно прав в команде';

/**
 * Членство не ниже требуемой роли — или исключение. Чистая функция: членство
 * могло быть прочитано заранее, в том числе под блокировкой в транзакции.
 */
export function requireRole(
  membership: Membership | null,
  required: TeamRole,
  forbidden: string = NOT_ENOUGH_RIGHTS,
): Membership {
  if (!membership) {
    throw new NotFoundError(TEAM_NOT_FOUND);
  }
  if (!hasTeamRole(membership.role, required)) {
    throw new ForbiddenError(forbidden);
  }
  return membership;
}

/** Права по членству в команде — для доменов, которым нужно только это */
export class TeamAccess {
  constructor(private readonly teams: TeamsRepository) {}

  /** Тот же доступ внутри транзакции: членство читается её исполнителем */
  static forExecutor(executor: DbExecutor): TeamAccess {
    return new TeamAccess(new TeamsRepository(executor));
  }

  /** Членство или null: команды может не быть, либо актёр в ней не состоит */
  async membershipOf(teamId: string, actorId: string | null): Promise<Membership | null> {
    if (!actorId) {
      return null;
    }
    return this.teams.findMembership(teamId, actorId);
  }

  /**
   * Членство не ниже требуемой роли. `forbidden` — доменный текст: он объясняет
   * пользователю, кому именно это действие разрешено, и потому задаётся на
   * стороне вызывающего.
   */
  async require(
    teamId: string,
    actorId: string | null,
    required: TeamRole,
    forbidden?: string,
  ): Promise<Membership> {
    return requireRole(await this.membershipOf(teamId, actorId), required, forbidden);
  }

  /**
   * Проверка без исключения — там, где недостаток прав не ошибка, а другой
   * уровень доступа (например, доска, открытая по ссылке).
   */
  async isAtLeast(teamId: string, actorId: string | null, required: TeamRole): Promise<boolean> {
    const membership = await this.membershipOf(teamId, actorId);
    return membership !== null && hasTeamRole(membership.role, required);
  }
}
