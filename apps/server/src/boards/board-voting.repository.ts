import type { BoardItemContent } from '@estimate/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { DbExecutor } from '../common/db-executor';
import { schema } from '../db';

import type { BoardVoteRecord, BoardVotingRecord } from './board-voting-state';

type VotingRow = typeof schema.boardVotings.$inferSelect;

/** Запросы к голосованиям досок (15.2). Внутри транзакции создаётся с tx */
export class BoardVotingRepository {
  constructor(private readonly db: DbExecutor) {}

  /** Идущее голосование, иначе последнее завершённое с не скрытыми итогами */
  async findCurrent(boardId: string): Promise<BoardVotingRecord | null> {
    const t = schema.boardVotings;
    const [row] = await this.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.boardId, boardId),
          sql`(${t.status} = 'active' or (${t.status} = 'closed' and ${t.resultsHidden} = false))`,
        ),
      )
      // active раньше closed, среди завершённых — самое позднее
      .orderBy(sql`${t.status} = 'active' desc`, desc(t.startedAt))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  /** Голосование с блокировкой строки — голоса одного голосования применяются строго по очереди */
  async lock(boardId: string, votingId: string): Promise<BoardVotingRecord | null> {
    const t = schema.boardVotings;
    const [row] = await this.db
      .select()
      .from(t)
      .where(and(eq(t.id, votingId), eq(t.boardId, boardId)))
      .for('update');
    return row ? toRecord(row) : null;
  }

  async insert(values: {
    boardId: string;
    createdBy: string | null;
    votesPerParticipant: number;
    maxPerItem: number;
    itemIds: string[] | null;
  }): Promise<BoardVotingRecord> {
    const [row] = await this.db.insert(schema.boardVotings).values(values).returning();
    if (!row) throw new Error('Не удалось создать голосование');
    return toRecord(row);
  }

  /** Меняет только голосование в нужном статусе; false — такого нет (уже завершено/отменено) */
  async close(boardId: string, votingId: string): Promise<boolean> {
    const t = schema.boardVotings;
    const rows = await this.db
      .update(t)
      .set({ status: 'closed', closedAt: new Date() })
      .where(and(eq(t.id, votingId), eq(t.boardId, boardId), eq(t.status, 'active')))
      .returning({ id: t.id });
    return rows.length > 0;
  }

  async cancel(boardId: string, votingId: string): Promise<boolean> {
    const t = schema.boardVotings;
    const rows = await this.db
      .delete(t)
      .where(and(eq(t.id, votingId), eq(t.boardId, boardId), eq(t.status, 'active')))
      .returning({ id: t.id });
    return rows.length > 0;
  }

  async hideResults(boardId: string, votingId: string): Promise<boolean> {
    const t = schema.boardVotings;
    const rows = await this.db
      .update(t)
      .set({ resultsHidden: true })
      .where(and(eq(t.id, votingId), eq(t.boardId, boardId), eq(t.status, 'closed')))
      .returning({ id: t.id });
    return rows.length > 0;
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
      .where(and(eq(v.votingId, votingId), eq(v.participantId, participantId)));
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

function toRecord(row: VotingRow): BoardVotingRecord {
  return {
    id: row.id,
    boardId: row.boardId,
    status: row.status,
    votesPerParticipant: row.votesPerParticipant,
    maxPerItem: row.maxPerItem,
    itemIds: row.itemIds ?? null,
    resultsHidden: row.resultsHidden,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
  };
}
