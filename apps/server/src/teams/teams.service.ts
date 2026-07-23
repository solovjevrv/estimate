import {
  TEAM_NAME_MAX_LENGTH,
  TEAM_NAME_MIN_LENGTH,
  type Team,
  type TeamMember,
  type TeamRole,
  type TeamWithRole,
  hasTeamRole,
} from '@poker/shared';

import type { Db } from '../db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors';

import { type Membership, TeamsRepository } from './teams.repository';

export interface TeamOverview {
  team: Team;
  role: TeamRole;
  members: TeamMember[];
  /** Только для тех, кто может приглашать */
  inviteCode?: string;
}

export interface RoleChangeResult {
  member: Membership;
  /** Роль вызывающего после операции: при передаче владения он становится админом */
  actorRole: TeamRole;
}

/**
 * Правила работы с командами. Все проверки прав живут здесь, а не в роутах:
 * изменения состава выполняются в транзакции с блокировкой строк, поэтому
 * одновременные запросы не могут оставить команду без владельца или с двумя.
 */
export class TeamsService {
  constructor(
    private readonly db: Db,
    private readonly repository: TeamsRepository,
  ) {}

  async create(actorId: string, rawName: string): Promise<TeamWithRole> {
    const name = this.normalizeName(rawName);

    const team = await this.db.transaction(async (tx) => {
      const repo = new TeamsRepository(tx);
      const created = await repo.insertTeam(name);
      await repo.insertMember(created.id, actorId, 'owner');
      return created;
    });

    return { id: team.id, name: team.name, createdAt: team.createdAt, role: 'owner' };
  }

  async listForUser(actorId: string): Promise<TeamWithRole[]> {
    return this.repository.listTeamsForUser(actorId);
  }

  async getOverview(actorId: string, teamId: string): Promise<TeamOverview> {
    const membership = this.ensureRole(
      await this.repository.findMembership(teamId, actorId),
      'guest',
    );
    const team = await this.repository.findTeamWithInvite(teamId);
    if (!team) {
      throw new NotFoundError('Команда не найдена');
    }

    return {
      team: { id: team.id, name: team.name, createdAt: team.createdAt },
      role: membership.role,
      members: this.visibleMembers(await this.repository.listMembers(teamId), membership.role),
      // Ссылка-приглашение — секрет: показываем её только тем, кто может звать
      ...(hasTeamRole(membership.role, 'admin') ? { inviteCode: team.inviteCode } : {}),
    };
  }

  async listMembers(actorId: string, teamId: string): Promise<TeamMember[]> {
    const membership = this.ensureRole(
      await this.repository.findMembership(teamId, actorId),
      'guest',
    );
    return this.visibleMembers(await this.repository.listMembers(teamId), membership.role);
  }

  async rename(actorId: string, teamId: string, rawName: string): Promise<Team> {
    const name = this.normalizeName(rawName);

    return this.inTransaction(teamId, actorId, 'owner', async (repo) => {
      const team = await repo.updateName(teamId, name);
      if (!team) {
        throw new NotFoundError('Команда не найдена');
      }
      return team;
    });
  }

  async remove(actorId: string, teamId: string): Promise<void> {
    await this.inTransaction(teamId, actorId, 'owner', async (repo) => {
      await repo.deleteTeam(teamId);
    });
  }

  async rotateInviteCode(actorId: string, teamId: string): Promise<string> {
    return this.inTransaction(teamId, actorId, 'admin', async (repo) => {
      const code = await repo.updateInviteCode(teamId, TeamsRepository.generateInviteCode());
      if (!code) {
        throw new NotFoundError('Команда не найдена');
      }
      return code;
    });
  }

  /**
   * Смена роли участника. Назначение нового владельца выполняется в одной
   * транзакции: прежний владелец сначала понижается до администратора,
   * поэтому владелец у команды всегда ровно один.
   */
  async changeMemberRole(
    actorId: string,
    teamId: string,
    targetUserId: string,
    role: TeamRole,
  ): Promise<RoleChangeResult> {
    return this.inTransaction(teamId, actorId, 'owner', async (repo, actor, members) => {
      const target = members.find((member) => member.userId === targetUserId);
      if (!target) {
        throw new NotFoundError('Участник не найден');
      }
      if (target.role === role) {
        return { member: target, actorRole: actor.role };
      }
      if (targetUserId === actorId) {
        // Единственный владелец не может понизить себя: команда осталась бы без хозяина
        throw new ConflictError('Сначала передайте владение другому участнику');
      }

      if (role === 'owner') {
        await repo.updateMemberRole(teamId, actorId, 'admin');
        await this.applyRole(repo, teamId, targetUserId, 'owner');
        return { member: { teamId, userId: targetUserId, role }, actorRole: 'admin' };
      }

      await this.applyRole(repo, teamId, targetUserId, role);
      return { member: { teamId, userId: targetUserId, role }, actorRole: actor.role };
    });
  }

  /** Исключение участника или собственный выход из команды */
  async removeMember(actorId: string, teamId: string, targetUserId: string): Promise<void> {
    await this.inTransaction(teamId, actorId, 'guest', async (repo, actor, members) => {
      const target = members.find((member) => member.userId === targetUserId);
      if (!target) {
        throw new NotFoundError('Участник не найден');
      }

      if (targetUserId === actorId) {
        // Выйти может каждый, но владелец — только передав команду
        const owners = members.filter((member) => member.role === 'owner').length;
        if (actor.role === 'owner' && owners === 1) {
          throw new ConflictError('Передайте владение или удалите команду');
        }
      } else if (!hasTeamRole(actor.role, 'admin')) {
        throw new ForbiddenError('Исключать участников могут владелец и администратор');
      } else if (actor.role === 'admin' && hasTeamRole(target.role, 'admin')) {
        throw new ForbiddenError('Администратор не может исключить владельца или администратора');
      }

      await repo.deleteMember(teamId, targetUserId);
    });
  }

  async previewInvite(code: string): Promise<Team> {
    const team = await this.repository.findTeamByInviteCode(code);
    if (!team) {
      throw new NotFoundError('Приглашение не найдено');
    }
    return team;
  }

  async joinByInvite(actorId: string, code: string): Promise<TeamWithRole> {
    const team = await this.repository.findTeamByInviteCode(code);
    if (!team) {
      throw new NotFoundError('Приглашение не найдено');
    }
    // Аккаунт могли удалить, а кука осталась — без этой проверки упрёмся в внешний ключ
    if (!(await this.repository.userExists(actorId))) {
      throw new UnauthorizedError();
    }

    await this.repository.insertMemberIfAbsent(team.id, actorId, 'member');
    const membership = await this.repository.findMembership(team.id, actorId);
    return { ...team, role: membership?.role ?? 'member' };
  }

  /**
   * Общая обвязка изменяющих операций: транзакция, блокировка состава команды
   * и проверка роли вызывающего уже под блокировкой.
   */
  private async inTransaction<T>(
    teamId: string,
    actorId: string,
    required: TeamRole,
    action: (repo: TeamsRepository, actor: Membership, members: Membership[]) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const repo = new TeamsRepository(tx);
      const members = await repo.lockMemberships(teamId);
      const actor = this.ensureRole(
        members.find((member) => member.userId === actorId) ?? null,
        required,
      );
      return action(repo, actor, members);
    });
  }

  /** Участник мог выйти между чтением и записью — тогда роль назначать некому */
  private async applyRole(
    repo: TeamsRepository,
    teamId: string,
    userId: string,
    role: TeamRole,
  ): Promise<void> {
    const updated = await repo.updateMemberRole(teamId, userId, role);
    if (updated !== 1) {
      throw new NotFoundError('Участник не найден');
    }
  }

  /** Чужим и несуществующим командам отвечаем одинаково — иначе id можно перебирать */
  private ensureRole(membership: Membership | null, required: TeamRole): Membership {
    if (!membership) {
      throw new NotFoundError('Команда не найдена');
    }
    if (!hasTeamRole(membership.role, required)) {
      throw new ForbiddenError('Недостаточно прав в команде');
    }
    return membership;
  }

  /** Гостю адреса участников не показываем — ему хватает имён */
  private visibleMembers(members: TeamMember[], viewerRole: TeamRole): TeamMember[] {
    if (hasTeamRole(viewerRole, 'member')) {
      return members;
    }
    return members.map((member) => {
      const withoutEmail = { ...member };
      delete withoutEmail.email;
      return withoutEmail;
    });
  }

  private normalizeName(raw: string): string {
    const name = raw.trim();
    if (name.length < TEAM_NAME_MIN_LENGTH || name.length > TEAM_NAME_MAX_LENGTH) {
      throw new ValidationError(
        `Название команды должно быть от ${TEAM_NAME_MIN_LENGTH} до ${TEAM_NAME_MAX_LENGTH} символов`,
      );
    }
    return name;
  }
}
