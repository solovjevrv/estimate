/**
 * PersonalStickersRepository на реальной PostgreSQL (21.6, живая проверка).
 * Мягкое удаление (deletedAt) и "оживление" пака при переимпорте (onConflictDoUpdate)
 * завязаны на реальное поведение Postgres (unique-конфликт по PK) — юнит-тесты с
 * замоканным репозиторием этого не проверяют. Без DATABASE_URL — пропускается.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, schema } from '../src/db';
import { PersonalStickersRepository } from '../src/boards/personal-stickers.repository';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb('PersonalStickersRepository — мягкое удаление и revive', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let repo: PersonalStickersRepository;
  const createdUserIds: string[] = [];
  const suffix = randomUUID();

  beforeAll(() => {
    ({ db, pool } = createDb(databaseUrl as string));
    repo = new PersonalStickersRepository(db);
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

  async function createUser(label: string): Promise<string> {
    const [user] = await db
      .insert(schema.users)
      .values({
        provider: 'google',
        providerId: `personal-stickers-repo-${suffix}-${label}`,
        email: `personal-stickers-repo-${suffix}-${label}@example.com`,
        name: 'Тестовый Пользователь',
      })
      .returning();
    if (!user) throw new Error('Не удалось создать пользователя для теста');
    createdUserIds.push(user.id);
    return user.id;
  }

  it('deletePack мягко удаляет: строка пака остаётся, стикеры стираются, из списка/квоты пак пропадает', async () => {
    const ownerId = await createUser('soft-delete');
    const packId = randomUUID();
    await repo.createPackWithStickers({
      packId,
      ownerId,
      telegramSetName: 'softdeletepack',
      title: 'Soft Delete Pack',
      stickers: [
        { stickerId: randomUUID(), telegramFileUniqueId: 'u1', emoji: '😀', byteSize: 100 },
      ],
    });

    const deleted = await repo.deletePack(packId, ownerId);
    expect(deleted).not.toBeNull();
    expect(deleted!.stickers).toHaveLength(1);

    // Пропал из списка и квоты...
    expect(await repo.listPacksByOwner(ownerId)).toHaveLength(0);
    expect(await repo.countPacksByOwner(ownerId)).toBe(0);

    // ...но метаданные всё ещё резолвятся публично (для бейджа «импортировать»
    // на осиротевшем стикере, уже размещённом на доске)
    const stillResolvable = await repo.getPackWithStickers(packId);
    expect(stillResolvable?.telegramSetName).toBe('softdeletepack');
    expect(stillResolvable?.stickers).toHaveLength(0);
  });

  it('повторное удаление уже удалённого пака — no-op (возвращает null, не падает)', async () => {
    const ownerId = await createUser('double-delete');
    const packId = randomUUID();
    await repo.createPackWithStickers({
      packId,
      ownerId,
      telegramSetName: 'doubledeletepack',
      title: 'Pack',
      stickers: [],
    });
    await repo.deletePack(packId, ownerId);

    const secondDelete = await repo.deletePack(packId, ownerId);
    expect(secondDelete).toBeNull();
  });

  it('createPackWithStickers с id удалённого пака "оживляет" ту же строку (revive)', async () => {
    const ownerId = await createUser('revive');
    const packId = randomUUID();
    await repo.createPackWithStickers({
      packId,
      ownerId,
      telegramSetName: 'revivepack',
      title: 'Old Title',
      stickers: [
        { stickerId: randomUUID(), telegramFileUniqueId: 'u1', emoji: '😀', byteSize: 100 },
      ],
    });
    await repo.deletePack(packId, ownerId);

    // Симулируем то, что делает сервис при переимпорте: находит удалённый
    // пак по (ownerId, telegramSetName), передаёт его id как packId заново
    const found = await repo.findPackByOwnerAndSetName(ownerId, 'revivepack');
    expect(found?.id).toBe(packId);
    expect(found?.deletedAt).not.toBeNull();

    const revived = await repo.createPackWithStickers({
      packId,
      ownerId,
      telegramSetName: 'revivepack',
      title: 'New Title After Reimport',
      stickers: [
        { stickerId: randomUUID(), telegramFileUniqueId: 'u2', emoji: '🎉', byteSize: 200 },
      ],
    });

    expect(revived.id).toBe(packId);
    expect(revived.title).toBe('New Title After Reimport');
    expect(revived.stickers).toHaveLength(1);

    // Пак снова активен — виден в списке/квоте
    const listed = await repo.listPacksByOwner(ownerId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(packId);
  });
});
