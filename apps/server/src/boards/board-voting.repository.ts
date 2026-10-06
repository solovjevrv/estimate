import type { BoardItemContent, BoardVotingSummary } from '@estimate/shared';
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';

import type { DbExecutor } from '../common/db-executor';
import { schema } from '../db';

import type { BoardVoteRecord, BoardVotingRecord } from './board-voting-state';

type VotingRow = typeof schema.boardVotings.$inferSelect;

/** Запросы к голосованиям досок (15.2). Внутри транзакции создаётся с tx */
export class BoardVotingRepository {
  constructor(private readonly db: DbExecutor) {}

  /** Идущее голосование, иначе последнее завершённое (его итоги видны сразу после завершения) */
  async findCurrent(boardId: string): Promise<BoardVotingRecord | null> {
    const t = schema.boardVotings;
    const [row] = await this.db
      .select({ ...getTableColumns(t), number: this.numberOf() })
      .from(t)
      .where(eq(t.boardId, boardId))
      // active раньше closed, среди завершённых — самое позднее
      .orderBy(sql`${t.status} = 'active' desc`, desc(t.startedAt))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  /** Завершённое голосование доски — итоги из истории */
  async findClosed(boardId: string, votingId: string): Promise<BoardVotingRecord | null> {
    const t = schema.boardVotings;
    const [row] = await this.db
      .select({ ...getTableColumns(t), number: this.numberOf() })
      .from(t)
      .where(and(eq(t.id, votingId), eq(t.boardId, boardId), eq(t.status, 'closed')))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  /** Завершённые голосования доски со сводкой — новые сверху */
  async listHistory(boardId: string): Promise<BoardVotingSummary[]> {
    const t = schema.boardVotings;
    const v = schema.boardVotes;
    const rows = await this.db
      .select({
        id: t.id,
        number: this.numberOf(),
        startedAt: t.startedAt,
        closedAt: t.closedAt,
        totalVotes: sql<number>`coalesce(sum(${v.count}), 0)::int`,
        voterCount: sql<number>`count(distinct ${v.participantId})::int`,
      })
      .from(t)
      // Голоса удалённых элементов не считаются (FK на элемент нет — см. schema.ts)
      .leftJoin(
        v,
        and(
          eq(v.votingId, t.id),
          sql`exists (select 1 from board_items where board_items.id = ${v.itemId})`,
        ),
      )
      .where(and(eq(t.boardId, boardId), eq(t.status, 'closed')))
      .groupBy(t.id)
      .orderBy(desc(t.startedAt));
    return rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Порядковый номер голосования на доске по времени старта. Отменённые
   * удаляются, поэтому номера идут подряд среди оставшихся.
   */
  private numberOf() {
    // Внешняя таблица — с явным именем: внутри подзапроса голое board_id
    // привязалось бы к earlier, и номер считался бы по всем доскам сразу
    return sql<number>`(select count(*)::int from board_votings as earlier where earlier.board_id = "board_votings"."board_id" and earlier.started_at <= "board_votings"."started_at")`;
  }

  /** Голосование с блокировкой строки — голоса одного голосования применяются строго по очереди */
  async lock(boardId: string, votingId: string): Promise<BoardVotingRecord | null> {
    const t = schema.boardVotings;
    const [row] = await this.db
      .select()
      .from(t)
      .where(and(eq(t.id, votingId), eq(t.boardId, boardId)))
      .for('update');
    // Номер голосованию под блокировкой не нужен — голос его не показывает
    return row ? toRecord({ ...row, number: 0 }) : null;
  }

  async insert(values: {
    boardId: string;
    createdBy: string | null;
    votesPerParticipant: number | null;
    maxPerItem: number | null;
    itemIds: string[] | null;
    withTimer: boolean;
  }): Promise<void> {
    await this.db.insert(schema.boardVotings).values(values);
  }

  /**
   * Меняет только идущее голосование. null — такого нет (уже завершено или
   * отменено), иначе — запускало ли оно таймер (его тогда нужно сбросить).
   */
  async close(boardId: string, votingId: string): Promise<{ withTimer: boolean } | null> {
    const t = schema.boardVotings;
    const [row] = await this.db
      .update(t)
      .set({ status: 'closed', closedAt: new Date() })
      .where(and(eq(t.id, votingId), eq(t.boardId, boardId), eq(t.status, 'active')))
      .returning({ withTimer: t.withTimer });
    return row ?? null;
  }

  async cancel(boardId: string, votingId: string): Promise<{ withTimer: boolean } | null> {
    const t = schema.boardVotings;
    const [row] = await this.db
      .delete(t)
      .where(and(eq(t.id, votingId), eq(t.boardId, boardId), eq(t.status, 'active')))
      .returning({ withTimer: t.withTimer });
    return row ?? null;
  }

  async listVotes(votingId: string): Promise<BoardVoteRecord[]> {
    const v = schema.boardVotes;
    return this.db
      .select({
        itemId: v.itemId,
        participantId: v.participantId,
        participantName: v.participantName,
        count: v.count,
      })
      .from(v)
      .innerJoin(schema.boardItems, eq(schema.boardItems.id, v.itemId))
      .where(eq(v.votingId, votingId));
  }

  async listParticipantVotes(votingId: string, participantId: string): Promise<BoardVoteRecord[]> {
    const v = schema.boardVotes;
    return this.db
      .select({
        itemId: v.itemId,
        participantId: v.participantId,
        participantName: v.participantName,
        count: v.count,
      })
      .from(v)
      .innerJoin(schema.boardItems, eq(schema.boardItems.id, v.itemId))
      .where(and(eq(v.votingId, votingId), eq(v.participantId, participantId)));
  }

  /** Удалить завершённое голосование (его голоса — каскадом). false — такого нет */
  async deleteClosed(boardId: string, votingId: string): Promise<boolean> {
    const t = schema.boardVotings;
    const rows = await this.db
      .delete(t)
      .where(and(eq(t.id, votingId), eq(t.boardId, boardId), eq(t.status, 'closed')))
      .returning({ id: t.id });
    return rows.length > 0;
  }

  /** Есть ли голоса у этих элементов в голосованиях доски — восстановленный undo элемент вернул их */
  async hasVotesFor(boardId: string, itemIds: readonly string[]): Promise<boolean> {
    if (itemIds.length === 0) return false;
    const t = schema.boardVotings;
    const v = schema.boardVotes;
    const [row] = await this.db
      .select({ itemId: v.itemId })
      .from(v)
      .innerJoin(t, eq(t.id, v.votingId))
      .where(and(eq(t.boardId, boardId), inArray(v.itemId, [...itemIds])))
      .limit(1);
    return !!row;
  }

  /** Новое число точек участника на элементе; 0 — убрать запись */
  async setVote(
    votingId: string,
    itemId: string,
    participant: { participantId: string; name: string },
    count: number,
  ): Promise<void> {
    const v = schema.boardVotes;
    const key = and(
      eq(v.votingId, votingId),
      eq(v.itemId, itemId),
      eq(v.participantId, participant.participantId),
    );
    if (count === 0) {
      await this.db.delete(v).where(key);
      return;
    }
    await this.db
      .insert(v)
      .values({
        votingId,
        itemId,
        participantId: participant.participantId,
        participantName: participant.name,
        count,
      })
      .onConflictDoUpdate({
        target: [v.votingId, v.itemId, v.participantId],
        set: { count, participantName: participant.name },
      });
  }

  /** Содержимое элементов доски по id — для проверки, за что можно голосовать */
  async listItemContents(
    boardId: string,
    itemIds: readonly string[],
  ): Promise<Array<{ id: string; content: BoardItemContent }>> {
    if (itemIds.length === 0) return [];
    const i = schema.boardItems;
    return this.db
      .select({ id: i.id, content: i.content })
      .from(i)
      .where(and(eq(i.boardId, boardId), inArray(i.id, [...itemIds])));
  }
}

function toRecord(row: VotingRow & { number: number }): BoardVotingRecord {
  return {
    id: row.id,
    boardId: row.boardId,
    status: row.status,
    votesPerParticipant: row.votesPerParticipant,
    maxPerItem: row.maxPerItem,
    itemIds: row.itemIds ?? null,
    withTimer: row.withTimer,
    number: row.number,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
  };
}
