import type { PersonalStickerFormat, PersonalStickerPackWithStickers } from '@poker/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

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
    format: PersonalStickerFormat;
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

  /**
   * Ищет пак по (ownerId, telegramSetName) вне зависимости от того, удалён ли
   * он (мягко) — вызывающая сторона (сервис) решает, что делать: активный пак
   * возвращает как есть (идемпотентность повторного импорта), удалённый —
   * "оживляет" через тот же packId (см. createPackWithStickers).
   */
  async findPackByOwnerAndSetName(
    ownerId: string,
    telegramSetName: string,
  ): Promise<{ id: string; deletedAt: Date | null } | null> {
    const [row] = await this.db
      .select({
        id: schema.personalStickerPacks.id,
        deletedAt: schema.personalStickerPacks.deletedAt,
      })
      .from(schema.personalStickerPacks)
      .where(
        and(
          eq(schema.personalStickerPacks.ownerId, ownerId),
          eq(schema.personalStickerPacks.telegramSetName, telegramSetName),
        ),
      )
      .limit(1);
    return row ? { id: row.id, deletedAt: row.deletedAt } : null;
  }

  /**
   * ownerId + format стикера по (packId, stickerId) — нужны для резолва ключа
   * в storage и Content-Type при публичной отдаче файла (21.6/21.7). JOIN, а
   * не два похода в БД: format лежит в personal_stickers, ownerId — в
   * personal_sticker_packs.
   */
  async findStickerLocation(
    packId: string,
    stickerId: string,
  ): Promise<{ ownerId: string; format: PersonalStickerFormat } | null> {
    const [row] = await this.db
      .select({
        ownerId: schema.personalStickerPacks.ownerId,
        format: schema.personalStickers.format,
      })
      .from(schema.personalStickers)
      .innerJoin(
        schema.personalStickerPacks,
        eq(schema.personalStickers.packId, schema.personalStickerPacks.id),
      )
      .where(
        and(eq(schema.personalStickers.packId, packId), eq(schema.personalStickers.id, stickerId)),
      )
      .limit(1);
    return row ? { ownerId: row.ownerId, format: row.format as PersonalStickerFormat } : null;
  }

  /** Мягко удалённые (deletedAt не null) не занимают квоту — не считаем их */
  async countPacksByOwner(ownerId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.personalStickerPacks)
      .where(
        and(
          eq(schema.personalStickerPacks.ownerId, ownerId),
          isNull(schema.personalStickerPacks.deletedAt),
        ),
      );
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
   * Одна транзакция: upsert в personal_sticker_packs, затем batch-insert строк
   * personal_stickers. Если по пути что-то упало — rollback, строки в БД не появятся.
   *
   * `onConflictDoUpdate` по id — не просто insert: сервис передаёт сюда либо
   * свежий randomUUID (обычный импорт), либо id уже существующей, но мягко
   * удалённой строки (переимпорт после удаления, см. deletedAt в схеме) —
   * тогда конфликт по PK "оживляет" ту же строку (title обновляется,
   * deletedAt сбрасывается) вместо ошибки уникальности. Старые personal_stickers
   * под этим packId к этому моменту уже удалены явно в deletePack.
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
        .onConflictDoUpdate({
          target: schema.personalStickerPacks.id,
          set: { title: input.title, deletedAt: null },
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
                  format: s.format,
                  byteSize: s.byteSize,
                })),
              )
              .returning()
          : [];

      return {
        id: input.packId,
        title: input.title,
        telegramSetName: input.telegramSetName,
        stickers: stickerRows.map((s) => ({
          id: s.id,
          emoji: s.emoji,
          format: s.format as PersonalStickerFormat,
        })),
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
      .select({
        id: schema.personalStickers.id,
        emoji: schema.personalStickers.emoji,
        format: schema.personalStickers.format,
      })
      .from(schema.personalStickers)
      .where(eq(schema.personalStickers.packId, packId));

    return {
      id: packRow.id,
      title: packRow.title,
      telegramSetName: packRow.telegramSetName,
      stickers: stickerRows.map((s) => ({
        id: s.id,
        emoji: s.emoji,
        format: s.format as PersonalStickerFormat,
      })),
    };
  }

  async listPacksByOwner(ownerId: string): Promise<PersonalStickerPackWithStickers[]> {
    // Запросим паки + стикеры двумя запросами, а не вложенным JOIN — проще.
    // Мягко удалённые (deletedAt не null) в список "моих паков" не попадают —
    // это только tombstone для восстановления telegramSetName по чужим/своим
    // осиротевшим стикерам на досках (см. deletedAt в схеме)
    const packRows = await this.db
      .select()
      .from(schema.personalStickerPacks)
      .where(
        and(
          eq(schema.personalStickerPacks.ownerId, ownerId),
          isNull(schema.personalStickerPacks.deletedAt),
        ),
      );

    if (packRows.length === 0) return [];

    const stickerRows = await this.db
      .select({
        id: schema.personalStickers.id,
        packId: schema.personalStickers.packId,
        emoji: schema.personalStickers.emoji,
        format: schema.personalStickers.format,
      })
      .from(schema.personalStickers)
      .where(sql`${schema.personalStickers.packId} IN ${packRows.map((p) => p.id)}`);

    const byPack = new Map<
      string,
      Array<{ id: string; emoji: string; format: PersonalStickerFormat }>
    >();
    for (const row of stickerRows) {
      const arr = byPack.get(row.packId) ?? [];
      arr.push({ id: row.id, emoji: row.emoji, format: row.format as PersonalStickerFormat });
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
   * "Удаляет" пак, только если он принадлежит ownerId (WHERE по обоим полям)
   * и ещё не был удалён раньше. Сами personal_stickers стираются взаправду
   * (и storage-объекты — в сервисе), но родительская строка помечается
   * deletedAt, а не удаляется — чтобы telegramSetName оставался резолвимым
   * для бейджа «импортировать» на уже осиротевших стикерах на досках
   * (нашли живой проверкой, 21.6: без этого повторный импорт падал 404).
   * Возвращает удалённые строки стикеров (нужны id для cleanup в storage).
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
            isNull(schema.personalStickerPacks.deletedAt),
          ),
        )
        .limit(1);

      if (packRow.length === 0) return null;

      const pack = packRow[0]!;

      const stickerRows = await tx
        .select({
          id: schema.personalStickers.id,
          emoji: schema.personalStickers.emoji,
          format: schema.personalStickers.format,
        })
        .from(schema.personalStickers)
        .where(eq(schema.personalStickers.packId, packId));

      // Стикеры стираются взаправду — при переимпорте (revive) вставляются заново
      await tx.delete(schema.personalStickers).where(eq(schema.personalStickers.packId, packId));

      await tx
        .update(schema.personalStickerPacks)
        .set({ deletedAt: new Date() })
        .where(eq(schema.personalStickerPacks.id, packId));

      return {
        id: pack.id,
        title: pack.title,
        telegramSetName: pack.telegramSetName,
        stickers: stickerRows.map((s) => ({
          id: s.id,
          emoji: s.emoji,
          format: s.format as PersonalStickerFormat,
        })),
      };
    });
  }
}
