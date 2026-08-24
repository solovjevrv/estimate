import type { PersonalStickerPackWithStickers } from '@poker/shared';
import { and, eq, sql } from 'drizzle-orm';

import { schema } from '../db';
import type { Db } from '../db';

export interface CreatePackInput {
  packId: string;
  ownerId: string;
  telegramSetName: string;
  title: string;
  stickers: Array<{
    stickerId: string;
    telegramFileUniqueId: string;
    emoji: string;
    byteSize: number;
  }>;
}

/**
 * Все запросы к таблицам личных стикер-паков. `createPackWithStickers`
 * управляет транзакцией внутри себя — конструктору передаётся полный `Db`
 * (не `DbExecutor`), чтобы `.transaction()` был доступен.
 */
export class PersonalStickersRepository {
  constructor(private readonly db: Db) {}

  async findPackByOwnerAndSetName(
    ownerId: string,
    telegramSetName: string,
  ): Promise<{ id: string } | null> {
    const [row] = await this.db
      .select({ id: schema.personalStickerPacks.id })
      .from(schema.personalStickerPacks)
      .where(
        and(
          eq(schema.personalStickerPacks.ownerId, ownerId),
          eq(schema.personalStickerPacks.telegramSetName, telegramSetName),
        ),
      )
      .limit(1);
    return row ? { id: row.id } : null;
  }

  /** ownerId по packId — нужен для резолва ключа в storage при публичной отдаче стикера */
  async findPackOwner(packId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ ownerId: schema.personalStickerPacks.ownerId })
      .from(schema.personalStickerPacks)
      .where(eq(schema.personalStickerPacks.id, packId))
      .limit(1);
    return row ? row.ownerId : null;
  }

  async countPacksByOwner(ownerId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.personalStickerPacks)
      .where(eq(schema.personalStickerPacks.ownerId, ownerId));
    return Number(row?.count ?? 0);
  }

  async sumBytesByOwner(ownerId: string): Promise<number> {
    const [row] = await this.db
      .select({ sum: sql<number>`COALESCE(sum(${schema.personalStickers.byteSize}), 0)` })
      .from(schema.personalStickers)
      .innerJoin(
        schema.personalStickerPacks,
        eq(schema.personalStickers.packId, schema.personalStickerPacks.id),
      )
      .where(eq(schema.personalStickerPacks.ownerId, ownerId));
    return Number(row?.sum ?? 0);
  }

  /**
   * Одна транзакция: insert в personal_sticker_packs, затем batch-insert строк
   * personal_stickers. Если по пути что-то упало — rollback, строки в БД не появятся.
   */
  async createPackWithStickers(input: CreatePackInput): Promise<PersonalStickerPackWithStickers> {
    return await this.db.transaction(async (tx) => {
      const [packRow] = await tx
        .insert(schema.personalStickerPacks)
        .values({
          id: input.packId,
          ownerId: input.ownerId,
          telegramSetName: input.telegramSetName,
          title: input.title,
        })
        .returning();

      if (!packRow) {
        throw new Error('Не удалось создать пак стикеров');
      }

      const stickerRows =
        input.stickers.length > 0
          ? await tx
              .insert(schema.personalStickers)
              .values(
                input.stickers.map((s) => ({
                  id: s.stickerId,
                  packId: input.packId,
                  telegramFileUniqueId: s.telegramFileUniqueId,
                  emoji: s.emoji,
                  byteSize: s.byteSize,
                })),
              )
              .returning()
          : [];

      return {
        id: input.packId,
        title: input.title,
        telegramSetName: input.telegramSetName,
        stickers: stickerRows.map((s) => ({ id: s.id, emoji: s.emoji })),
      };
    });
  }

  /** Публичное чтение — без фильтра по владельцу (см. §0.2) */
  async getPackWithStickers(packId: string): Promise<PersonalStickerPackWithStickers | null> {
    const [packRow] = await this.db
      .select()
      .from(schema.personalStickerPacks)
      .where(eq(schema.personalStickerPacks.id, packId))
      .limit(1);

    if (!packRow) return null;

    const stickerRows = await this.db
      .select({ id: schema.personalStickers.id, emoji: schema.personalStickers.emoji })
      .from(schema.personalStickers)
      .where(eq(schema.personalStickers.packId, packId));

    return {
      id: packRow.id,
      title: packRow.title,
      telegramSetName: packRow.telegramSetName,
      stickers: stickerRows.map((s) => ({ id: s.id, emoji: s.emoji })),
    };
  }

  async listPacksByOwner(ownerId: string): Promise<PersonalStickerPackWithStickers[]> {
    // Запросим паки + стикеры двумя запросами, а не вложенным JOIN — проще и
    // не меняет поведение при удалении пака (каскадно)
    const packRows = await this.db
      .select()
      .from(schema.personalStickerPacks)
      .where(eq(schema.personalStickerPacks.ownerId, ownerId));

    if (packRows.length === 0) return [];

    const stickerRows = await this.db
      .select({
        id: schema.personalStickers.id,
        packId: schema.personalStickers.packId,
        emoji: schema.personalStickers.emoji,
      })
      .from(schema.personalStickers)
      .where(sql`${schema.personalStickers.packId} IN ${packRows.map((p) => p.id)}`);

    const byPack = new Map<string, Array<{ id: string; emoji: string }>>();
    for (const row of stickerRows) {
      const arr = byPack.get(row.packId) ?? [];
      arr.push({ id: row.id, emoji: row.emoji });
      byPack.set(row.packId, arr);
    }

    return packRows.map((pack) => ({
      id: pack.id,
      title: pack.title,
      telegramSetName: pack.telegramSetName,
      stickers: byPack.get(pack.id) ?? [],
    }));
  }

  /**
   * Удаляет пак, только если он принадлежит ownerId (WHERE по обоим полям).
   * Возвращает удалённые строки (нужны id стикеров для cleanup в storage).
   */
  async deletePack(
    packId: string,
    ownerId: string,
  ): Promise<PersonalStickerPackWithStickers | null> {
    return await this.db.transaction(async (tx) => {
      const packRow = await tx
        .select()
        .from(schema.personalStickerPacks)
        .where(
          and(
            eq(schema.personalStickerPacks.id, packId),
            eq(schema.personalStickerPacks.ownerId, ownerId),
          ),
        )
        .limit(1);

      if (packRow.length === 0) return null;

      const pack = packRow[0]!;

      const stickerRows = await tx
        .select({ id: schema.personalStickers.id, emoji: schema.personalStickers.emoji })
        .from(schema.personalStickers)
        .where(eq(schema.personalStickers.packId, packId));

      // Каскадно удалит и стикеры (ON DELETE CASCADE)
      await tx
        .delete(schema.personalStickerPacks)
        .where(eq(schema.personalStickerPacks.id, packId));

      return {
        id: pack.id,
        title: pack.title,
        telegramSetName: pack.telegramSetName,
        stickers: stickerRows.map((s) => ({ id: s.id, emoji: s.emoji })),
      };
    });
  }
}
