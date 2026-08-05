import { randomBytes } from 'node:crypto';

import type { Team, TeamMember, TeamMemberProfile, TeamRole } from '@poker/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { schema } from '../db';

/** Транзакция Drizzle: тот же интерфейс запросов, что и у соединения */
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbExecutor = Db | Transaction;

export interface Membership {
  teamId: string;
  userId: string;
  role: TeamRole;
}

/** Все запросы к таблицам команд. Внутри транзакции создаётся с tx вместо соединения. */
export class TeamsRepository {
  constructor(private readonly db: DbExecutor) {}

  /** Код приглашения: короткий, но неугадываемый (72 бита случайности) */
  static generateInviteCode(): string {
    return randomBytes(9).toString('base64url');
  }

  async insertTeam(name: string): Promise<Team & { inviteCode: string }> {
    const [row] = await this.db
      .insert(schema.teams)
      .values({ name, inviteCode: TeamsRepository.generateInviteCode() })
      .returning();
    if (!row) {
      throw new Error('Не удалось создать команду');
    }
    return { ...this.toTeam(row), inviteCode: row.inviteCode };
  }

  async insertMember(teamId: string, userId: string, role: TeamRole): Promise<void> {
    await this.db.insert(schema.teamMembers).values({ teamId, userId, role });
  }

  /** Вступление по ссылке идемпотентно: повторный переход не меняет уже выданную роль */
  async insertMemberIfAbsent(teamId: string, userId: string, role: TeamRole): Promise<void> {
    await this.db
      .insert(schema.teamMembers)
      .values({ teamId, userId, role })
      .onConflictDoNothing({ target: [schema.teamMembers.teamId, schema.teamMembers.userId] });
  }

  async listTeamsForUser(
    userId: string,
  ): Promise<Array<Team & { role: TeamRole; memberCount: number }>> {
    const rows = await this.db
      .select({ team: schema.teams, role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
      .where(eq(schema.teamMembers.userId, userId))
      .orderBy(schema.teams.createdAt);

    if (rows.length === 0) {
      return [];
    }

    // Отдельным запросом, а не join+group by в первом — состав команд читается
    // редко и в основном запросе, а тут просто список счётчиков по тем же id
    const teamIds = rows.map(({ team }) => team.id);
    const counts = await this.db
      .select({ teamId: schema.teamMembers.teamId, count: sql<number>`count(*)::int` })
      .from(schema.teamMembers)
      .where(inArray(schema.teamMembers.teamId, teamIds))
      .groupBy(schema.teamMembers.teamId);
    const countByTeamId = new Map(counts.map((row) => [row.teamId, row.count]));

    return rows.map(({ team, role }) => ({
      ...this.toTeam(team),
      role,
      memberCount: countByTeamId.get(team.id) ?? 0,
    }));
  }

  /** Команда вместе с кодом приглашения — читается одним запросом */
  async findTeamWithInvite(teamId: string): Promise<(Team & { inviteCode: string }) | null> {
    const [row] = await this.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .limit(1);
    return row ? { ...this.toTeam(row), inviteCode: row.inviteCode } : null;
  }

  async findTeamByInviteCode(code: string): Promise<Team | null> {
    const [row] = await this.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.inviteCode, code))
      .limit(1);
    return row ? this.toTeam(row) : null;
  }

  async findMembership(teamId: string, userId: string): Promise<Membership | null> {
    const [row] = await this.db
      .select()
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)))
      .limit(1);
    return row ? { teamId: row.teamId, userId: row.userId, role: row.role } : null;
  }

  /**
   * Состав команды с блокировкой строк до конца транзакции.
   * Без неё две одновременные смены ролей могут оставить команду
   * без единого администратора.
   */
  async lockMemberships(teamId: string): Promise<Membership[]> {
    const rows = await this.db
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, teamId))
      // Единый порядок блокировки строк, чтобы параллельные транзакции не встали в тупик
      .orderBy(schema.teamMembers.userId)
      .for('update');
    return rows.map((row) => ({ teamId: row.teamId, userId: row.userId, role: row.role }));
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    const rows = await this.db
      .select({
        userId: schema.users.id,
        // Провайдер перезаписывает users.name при каждом входе — правка пользователя
        // (9.2) живёт в display_name, поэтому наружу отдаём именно её при наличии
        name: sql<string>`coalesce(${schema.users.displayName}, ${schema.users.name})`,
        email: schema.users.email,
        // Провайдер перезаписывает users.avatarUrl при каждом входе — своя загруженная
        // аватарка (10.15) живёт в avatar_override_url, отдаём её при наличии
        avatarUrl: sql<
          string | null
        >`coalesce(${schema.users.avatarOverrideUrl}, ${schema.users.avatarUrl})`,
        role: schema.teamMembers.role,
        joinedAt: schema.teamMembers.joinedAt,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
      .where(eq(schema.teamMembers.teamId, teamId))
      .orderBy(schema.teamMembers.joinedAt);

    return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }));
  }

  /** Один участник со всеми полями его профиля — для его собственной страницы (10.14) */
  async findMemberProfile(teamId: string, userId: string): Promise<TeamMemberProfile | null> {
    const [row] = await this.db
      .select({
        userId: schema.users.id,
        name: sql<string>`coalesce(${schema.users.displayName}, ${schema.users.name})`,
        email: schema.users.email,
        avatarUrl: sql<
          string | null
        >`coalesce(${schema.users.avatarOverrideUrl}, ${schema.users.avatarUrl})`,
        provider: schema.users.provider,
        jobTitle: schema.users.jobTitle,
        role: schema.teamMembers.role,
        joinedAt: schema.teamMembers.joinedAt,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)))
      .limit(1);
    return row ? { ...row, joinedAt: row.joinedAt.toISOString() } : null;
  }

  async updateName(teamId: string, name: string): Promise<Team | null> {
    const [row] = await this.db
      .update(schema.teams)
      .set({ name })
      .where(eq(schema.teams.id, teamId))
      .returning();
    return row ? this.toTeam(row) : null;
  }

  async updateInviteCode(teamId: string, code: string): Promise<string | null> {
    const [row] = await this.db
      .update(schema.teams)
      .set({ inviteCode: code })
      .where(eq(schema.teams.id, teamId))
      .returning({ inviteCode: schema.teams.inviteCode });
    return row?.inviteCode ?? null;
  }

  /** Возвращает число изменённых строк — вызывающий проверяет, что участник ещё на месте */
  async updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<number> {
    const rows = await this.db
      .update(schema.teamMembers)
      .set({ role })
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)))
      .returning({ userId: schema.teamMembers.userId });
    return rows.length;
  }

  async deleteTeam(teamId: string): Promise<void> {
    await this.db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  }

  async deleteMember(teamId: string, userId: string): Promise<void> {
    await this.db
      .delete(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)));
  }

  private toTeam(row: typeof schema.teams.$inferSelect): Team {
    return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
  }
}
