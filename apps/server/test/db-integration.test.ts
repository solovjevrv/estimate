/**
 * Интеграционные тесты с реальной PostgreSQL: миграции и поведение констрейнтов.
 * Локально используют БД из docker-compose (корневой .env), в CI — service-контейнер.
 * Без DATABASE_URL — пропускаются.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, schema } from '../src/db';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

/** Drizzle оборачивает ошибку БД: имя констрейнта — в cause, а не в message */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'ожидалась ошибка БД').not.toBeNull();
  const cause = (err as { cause?: unknown }).cause;
  expect(String(cause ?? err)).toMatch(pattern);
}

describeDb('интеграция с PostgreSQL', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  const roomId = randomUUID();
  const roundId = randomUUID();

  beforeAll(async () => {
    // Миграции уже накачены в test/global-setup.ts
    ({ db, pool } = createDb(databaseUrl as string));
    await db.insert(schema.rooms).values({ id: roomId, name: 'Тестовая комната' });
    await db.insert(schema.rounds).values({ id: roundId, roomId, seq: 1, deckType: 'fibonacci' });
  });

  afterAll(async () => {
    try {
      await db?.delete(schema.rooms).where(eq(schema.rooms.id, roomId));
    } finally {
      await pool?.end();
    }
  });

  it('миграции идемпотентны (повторный прогон не падает)', async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  it('комната создаётся без команды и без создателя', async () => {
    // Уже создана в beforeAll с team_id = null и creator_id = null
    const rows = await db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.teamId).toBeNull();
  });

  it('гость голосует, повторный голос того же гостя отклоняется', async () => {
    await db
      .insert(schema.votes)
      .values({ roundId, guestSessionId: 'guest-1', guestName: 'Гость', value: 5 });

    await expectDbError(
      db
        .insert(schema.votes)
        .values({ roundId, guestSessionId: 'guest-1', guestName: 'Гость', value: 8 }),
      /votes_round_guest_idx|duplicate/i,
    );
  });

  it('голос одновременно от пользователя и гостя отклоняется (XOR)', async () => {
    await expectDbError(
      db.insert(schema.votes).values({
        roundId,
        userId: randomUUID(),
        guestSessionId: 'guest-2',
        guestName: 'Гость',
        value: 3,
      }),
      /votes_identity_check/i,
    );
  });

  it('отрицательное значение голоса отклоняется', async () => {
    await expectDbError(
      db
        .insert(schema.votes)
        .values({ roundId, guestSessionId: 'guest-3', guestName: 'Гость', value: -1 }),
      /votes_value_check/i,
    );
  });
});
