import {
  TEAM_NAME_MAX_LENGTH,
  TEAM_NAME_MIN_LENGTH,
  type Team,
  type TeamMember,
  type TeamMemberProfile,
  type TeamRole,
  type TeamWithRole,
  hasTeamRole,
  isTextLengthInRange,
  trimText,
} from '@estimate/shared';

import { requireRole } from '../access';
import { type Db, isForeignKeyViolation, isUniqueViolation } from '../db';
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

/** Внешние ключи team_members — по ним отличаем удалённую команду от удалённого аккаунта */
const TEAM_FK = 'team_members_team_id_teams_id_fk';
const USER_FK = 'team_members_user_id_users_id_fk';

/** Сколько раз пробуем выпустить неповторяющийся код приглашения */
const MAX_INVITE_ATTEMPTS = 3;

export interface RoleChangeResult {
  member: Membership;
  /** Роль вызывающего после операции: меняется, только если он менял роль сам себе */
  actorRole: TeamRole;
}

/**
 * Правила работы с командами. Все проверки прав живут здесь, а не в роутах:
 * изменения состава выполняются в транзакции с блокировкой строк, поэтому
 * одновременные запросы не могут оставить команду без единого администратора.
 * Администраторов может быть несколько — все равны в правах.
 */
export class TeamsService {
  /** Репозиторий должен работать с тем же соединением, что и транзакции сервиса */
  constructor(
    private readonly db: Db,
    private readonly repository: TeamsRepository,
  ) {}

  /** Обычный способ собрать сервис: репозиторий на том же соединении */
  static forDatabase(db: Db): TeamsService {
    return new TeamsService(db, new TeamsRepository(db));
  }

  async create(actorId: string, rawName: string): Promise<TeamWithRole> {
    const name = this.normalizeName(rawName);

    const team = await this.db.transaction(async (tx) => {
      const repo = new TeamsRepository(tx);
      const created = await repo.insertTeam(name);
      await repo.insertMember(created.id, actorId, 'admin');
      return created;
    });

    // Создатель — единственный участник на момент создания
    return {
      id: team.id,
      name: team.name,
      createdAt: team.createdAt,
      role: 'admin',
      memberCount: 1,
    };
  }

  async listForUser(actorId: string): Promise<TeamWithRole[]> {
    return this.repository.listTeamsForUser(actorId);
  }

  async getOverview(actorId: string, teamId: string): Promise<TeamOverview> {
    const membership = requireRole(await this.repository.findMembership(teamId, actorId), 'guest');
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
    const membership = requireRole(await this.repository.findMembership(teamId, actorId), 'guest');
    return this.visibleMembers(await this.repository.listMembers(teamId), membership.role);
  }

  /** Карточка одного участника (10.14) — доступна только тем, кто сам состоит в команде */
  async getMember(
    actorId: string,
    teamId: string,
    targetUserId: string,
  ): Promise<TeamMemberProfile> {
    const membership = requireRole(await this.repository.findMembership(teamId, actorId), 'guest');
    const member = await this.repository.findMemberProfile(teamId, targetUserId);
    if (!member) {
      throw new NotFoundError('Участник не найден');
    }
    if (hasTeamRole(membership.role, 'member')) {
      return member;
    }
    const withoutEmail = { ...member };
    delete withoutEmail.email;
    return withoutEmail;
  }

  async rename(actorId: string, teamId: string, rawName: string): Promise<Team> {
    const name = this.normalizeName(rawName);

    return this.inTransaction(teamId, actorId, 'admin', async (repo) => {
      const team = await repo.updateName(teamId, name);
      if (!team) {
        throw new NotFoundError('Команда не найдена');
      }
      return team;
    });
  }

  async remove(actorId: string, teamId: string): Promise<void> {
    await this.inTransaction(teamId, actorId, 'admin', async (repo) => {
      await repo.deleteTeam(teamId);
    });
  }

  async rotateInviteCode(actorId: string, teamId: string): Promise<string> {
    return this.inTransaction(teamId, actorId, 'admin', async (repo) =>
      this.rotateInviteCodeInTx(repo, teamId),
    );
  }

  /**
   * Смена роли участника. Понизить единственного администратора нельзя —
   * иначе команда осталась бы без администратора вовсе (неважно, кто именно
   * это делает: сам администратор или другой администратор его понижает).
   */
  async changeMemberRole(
    actorId: string,
    teamId: string,
    targetUserId: string,
    role: TeamRole,
  ): Promise<RoleChangeResult> {
    return this.inTransaction(teamId, actorId, 'admin', async (repo, actor, members) => {
      const target = members.find((member) => member.userId === targetUserId);
      if (!target) {
        throw new NotFoundError('Участник не найден');
      }
      if (target.role === role) {
        return { member: target, actorRole: actor.role };
      }
      if (target.role === 'admin' && role !== 'admin') {
        const admins = members.filter((member) => member.role === 'admin').length;
        if (admins === 1) {
          throw new ConflictError('В команде должен остаться хотя бы один администратор');
        }
      }

      await this.applyRole(repo, teamId, targetUserId, role);
      return {
        member: { teamId, userId: targetUserId, role },
        actorRole: targetUserId === actorId ? role : actor.role,
      };
    });
  }

  /**
   * Исключение участника или собственный выход из команды. Последнего
   * администратора нельзя убрать ни самовыходом, ни решением другого
   * администратора — команда не должна остаться без управления.
   */
  async removeMember(actorId: string, teamId: string, targetUserId: string): Promise<void> {
    await this.inTransaction(teamId, actorId, 'guest', async (repo, actor, members) => {
      const target = members.find((member) => member.userId === targetUserId);
      if (!target) {
        throw new NotFoundError('Участник не найден');
      }

      if (targetUserId !== actorId && actor.role !== 'admin') {
        // Составом команды управляет администратор: остальные только приглашают по ссылке
        throw new ForbiddenError('Исключать участников может только администратор');
      }
      if (target.role === 'admin') {
        const admins = members.filter((member) => member.role === 'admin').length;
        if (admins === 1) {
          throw new ConflictError('Назначьте другого администратора или удалите команду');
        }
      }

      await repo.deleteMember(teamId, targetUserId);

      if (targetUserId !== actorId) {
        // Исключённый мог сохранить ссылку-приглашение — прежний код для него аннулируем
        await this.rotateInviteCodeInTx(repo, teamId);
      }
    });
  }

  /** Совпадение кодов почти невероятно, но новая попытка дешевле ошибки у пользователя */
  private async rotateInviteCodeInTx(repo: TeamsRepository, teamId: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_INVITE_ATTEMPTS; attempt++) {
      try {
        const code = await repo.updateInviteCode(teamId, TeamsRepository.generateInviteCode());
        if (!code) {
          throw new NotFoundError('Команда не найдена');
        }
        return code;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === MAX_INVITE_ATTEMPTS - 1) {
          throw err;
        }
      }
    }
    throw new Error('Не удалось выпустить код приглашения');
  }

  async previewInvite(code: string): Promise<Team> {
    const team = await this.repository.findTeamByInviteCode(code);
    if (!team) {
      throw new NotFoundError('Приглашение не найдено');
    }
    return team;
  }

  async joinByInvite(actorId: string, code: string): Promise<Team & { role: TeamRole }> {
    const team = await this.repository.findTeamByInviteCode(code);
    if (!team) {
      throw new NotFoundError('Приглашение не найдено');
    }

    try {
      await this.repository.insertMemberIfAbsent(team.id, actorId, 'member');
    } catch (err) {
      // Пока шли к вставке, команду могли удалить, а аккаунт — закрыть:
      // внешние ключи ловят оба случая, и это не ошибка сервера
      if (isForeignKeyViolation(err, TEAM_FK)) {
        throw new NotFoundError('Приглашение не найдено');
      }
      if (isForeignKeyViolation(err, USER_FK)) {
        throw new UnauthorizedError();
      }
      throw err;
    }

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
      const actor = requireRole(
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
    const name = trimText(raw);
    if (!isTextLengthInRange(name, { min: TEAM_NAME_MIN_LENGTH, max: TEAM_NAME_MAX_LENGTH })) {
      throw new ValidationError(
        `Название команды должно быть от ${TEAM_NAME_MIN_LENGTH} до ${TEAM_NAME_MAX_LENGTH} символов`,
      );
    }
    return name;
  }
}
