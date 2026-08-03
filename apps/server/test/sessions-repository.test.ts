/**
 * SessionsRepository.deleteExpired на реальной PostgreSQL (7.29).
 * Без DATABASE_URL — пропускается.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SessionsRepository } from '../src/auth';
import { createDb, schema } from '../src/db';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb('SessionsRepository.deleteExpired', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  const createdUserIds: string[] = [];
  const suffix = randomUUID();

  beforeAll(() => {
    ({ db, pool } = createDb(databaseUrl as string));
  });

  afterAll(async () => {
    try {
      if (createdUserIds.length > 0) {
        await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
      }
    } finally {
      await pool?.end();
    }
  });

  async function createUser(): Promise<string> {
    const [user] = await db
      .insert(schema.users)
      .values({
        provider: 'google',
        providerId: `sessions-cleanup-${suffix}-${createdUserIds.length}`,
        email: `sessions-cleanup-${suffix}-${createdUserIds.length}@example.com`,
        name: 'Тестовый Пользователь',
      })
      .returning();
    if (!user) throw new Error('Не удалось создать пользователя для теста');
    createdUserIds.push(user.id);
    return user.id;
  }

  async function createSession(userId: string, expiresAt: Date): Promise<string> {
    const [session] = await db.insert(schema.sessions).values({ userId, expiresAt }).returning();
    if (!session) throw new Error('Не удалось создать сессию для теста');
    return session.id;
  }

  it('удаляет только строки с истёкшим expires_at, живые не трогает', async () => {
    const userId = await createUser();
    const expiredId = await createSession(userId, new Date(Date.now() - 1000));
    const activeId = await createSession(userId, new Date(Date.now() + 60_000));

    const deleted = await new SessionsRepository(db).deleteExpired();

    expect(deleted).toBeGreaterThanOrEqual(1);
    const remaining = await db
      .select()
      .from(schema.sessions)
      .where(inArray(schema.sessions.id, [expiredId, activeId]));
    expect(remaining.map((row) => row.id)).toEqual([activeId]);
  });

  it('живую сессию не трогает, даже если expires_at в будущем совсем рядом с now()', async () => {
    const userId = await createUser();
    const activeId = await createSession(userId, new Date(Date.now() + 60_000));

    await new SessionsRepository(db).deleteExpired();

    const remaining = await db
      .select()
      .from(schema.sessions)
      .where(inArray(schema.sessions.id, [activeId]));
    expect(remaining).toHaveLength(1);
  });
});
