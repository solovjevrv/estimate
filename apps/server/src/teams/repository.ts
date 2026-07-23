import { randomBytes } from 'node:crypto';

import type { Team, TeamMember, TeamRole, TeamWithRole } from '@poker/shared';
import { and, eq, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { schema } from '../db';

type TeamRow = typeof schema.teams.$inferSelect;

function toTeam(row: TeamRow): Team {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

/** Код приглашения: короткий, но неугадываемый (72 бита случайности) */
export function generateInviteCode(): string {
  return randomBytes(9).toString('base64url');
}

export interface Membership {
  teamId: string;
  userId: string;
  role: TeamRole;
}

export async function createTeam(db: Db, name: string, ownerId: string): Promise<TeamWithRole> {
  const team = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.teams)
      .values({ name, inviteCode: generateInviteCode() })
      .returning();
    if (!row) {
      throw new Error('Не удалось создать команду');
    }
    await tx.insert(schema.teamMembers).values({ teamId: row.id, userId: ownerId, role: 'owner' });
    return row;
  });

  return { ...toTeam(team), role: 'owner' };
}

export async function listTeamsForUser(db: Db, userId: string): Promise<TeamWithRole[]> {
  const rows = await db
    .select({ team: schema.teams, role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
    .where(eq(schema.teamMembers.userId, userId))
    .orderBy(schema.teams.createdAt);

  return rows.map(({ team, role }) => ({ ...toTeam(team), role }));
}

export async function findTeam(db: Db, teamId: string): Promise<Team | null> {
  const [row] = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).limit(1);
  return row ? toTeam(row) : null;
}

export async function findInviteCode(db: Db, teamId: string): Promise<string | null> {
  const [row] = await db
    .select({ inviteCode: schema.teams.inviteCode })
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .limit(1);
  return row?.inviteCode ?? null;
}

export async function findMembership(
  db: Db,
  teamId: string,
  userId: string,
): Promise<Membership | null> {
  const [row] = await db
    .select()
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)))
    .limit(1);
  return row ? { teamId: row.teamId, userId: row.userId, role: row.role } : null;
}

export async function listMembers(db: Db, teamId: string): Promise<TeamMember[]> {
  const rows = await db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
      role: schema.teamMembers.role,
      joinedAt: schema.teamMembers.joinedAt,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
    .where(eq(schema.teamMembers.teamId, teamId))
    .orderBy(schema.teamMembers.joinedAt);

  return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }));
}

export async function renameTeam(db: Db, teamId: string, name: string): Promise<Team | null> {
  const [row] = await db
    .update(schema.teams)
    .set({ name })
    .where(eq(schema.teams.id, teamId))
    .returning();
  return row ? toTeam(row) : null;
}

export async function deleteTeam(db: Db, teamId: string): Promise<void> {
  await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
}

export async function countOwners(db: Db, teamId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.role, 'owner')));
  return row?.count ?? 0;
}

/**
 * Меняет роль участника. Передача владения выполняется одной транзакцией:
 * новый владелец получает owner, прежний становится admin — команда не остаётся
 * без владельца и не получает второго.
 */
export async function setMemberRole(
  db: Db,
  teamId: string,
  targetUserId: string,
  role: TeamRole,
  currentOwnerId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.teamMembers)
      .set({ role })
      .where(
        and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, targetUserId)),
      );

    if (role === 'owner' && targetUserId !== currentOwnerId) {
      await tx
        .update(schema.teamMembers)
        .set({ role: 'admin' })
        .where(
          and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, currentOwnerId)),
        );
    }
  });
}

export async function removeMember(db: Db, teamId: string, userId: string): Promise<void> {
  await db
    .delete(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)));
}

export async function rotateInviteCode(db: Db, teamId: string): Promise<string | null> {
  // Коллизия кода почти невероятна, но повтор дешевле, чем 500 у пользователя
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateInviteCode();
    try {
      const [row] = await db
        .update(schema.teams)
        .set({ inviteCode: code })
        .where(eq(schema.teams.id, teamId))
        .returning({ inviteCode: schema.teams.inviteCode });
      return row?.inviteCode ?? null;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 2) {
        throw err;
      }
    }
  }
  return null;
}

export async function findTeamByInviteCode(db: Db, code: string): Promise<Team | null> {
  const [row] = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.inviteCode, code))
    .limit(1);
  return row ? toTeam(row) : null;
}

/** Вступление по ссылке идемпотентно: повторный переход не меняет уже выданную роль */
export async function addMemberIfAbsent(
  db: Db,
  teamId: string,
  userId: string,
  role: TeamRole = 'member',
): Promise<void> {
  await db
    .insert(schema.teamMembers)
    .values({ teamId, userId, role })
    .onConflictDoNothing({ target: [schema.teamMembers.teamId, schema.teamMembers.userId] });
}

/** Drizzle прячет ошибку драйвера в cause */
function isUniqueViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } }).cause;
  return cause?.code === '23505' || (err as { code?: string }).code === '23505';
}
