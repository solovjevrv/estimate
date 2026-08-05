import type { Board, BoardEdge, BoardItem } from '@poker/shared';
import { and, eq, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { schema } from '../db';

/** Транзакция Drizzle: тот же интерфейс запросов, что и у соединения */
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbExecutor = Db | Transaction;

/** Все запросы к таблицам досок. Внутри транзакции создаётся с tx вместо соединения. */
export class BoardsRepository {
  constructor(private readonly db: DbExecutor) {}

  async insertBoard(title: string, teamId: string | null, ownerId: string): Promise<Board> {
    const [row] = await this.db
      .insert(schema.boards)
      .values({ title, teamId, ownerId })
      .returning();
    if (!row) {
      throw new Error('Не удалось создать доску');
    }
    return this.toBoard(row);
  }

  async findBoard(boardId: string): Promise<Board | null> {
    const [row] = await this.db
      .select()
      .from(schema.boards)
      .where(eq(schema.boards.id, boardId))
      .limit(1);
    return row ? this.toBoard(row) : null;
  }

  /** Доска с блокировкой строки — под ней выполняются переименование/архивация/удаление */
  async lockBoard(boardId: string): Promise<Board | null> {
    const [row] = await this.db
      .select()
      .from(schema.boards)
      .where(eq(schema.boards.id, boardId))
      .for('update');
    return row ? this.toBoard(row) : null;
  }

  /** Личные доски пользователя (team_id пуст) вместе с числом элементов на каждой */
  async listPersonalBoards(
    ownerId: string,
    archived = false,
  ): Promise<Array<Board & { itemCount: number }>> {
    const rows = await this.db
      .select({
        board: schema.boards,
        itemCount: sql<number>`count(${schema.boardItems.id})::int`,
      })
      .from(schema.boards)
      .leftJoin(schema.boardItems, eq(schema.boardItems.boardId, schema.boards.id))
      .where(
        and(
          eq(schema.boards.ownerId, ownerId),
          sql`${schema.boards.teamId} is null`,
          eq(schema.boards.status, archived ? 'archived' : 'active'),
        ),
      )
      .groupBy(schema.boards.id)
      .orderBy(sql`${schema.boards.updatedAt} desc`);
    return rows.map(({ board, itemCount }) => ({ ...this.toBoard(board), itemCount }));
  }

  /** Доски команды вместе с числом элементов на каждой */
  async listTeamBoards(
    teamId: string,
    archived = false,
  ): Promise<Array<Board & { itemCount: number }>> {
    const rows = await this.db
      .select({
        board: schema.boards,
        itemCount: sql<number>`count(${schema.boardItems.id})::int`,
      })
      .from(schema.boards)
      .leftJoin(schema.boardItems, eq(schema.boardItems.boardId, schema.boards.id))
      .where(
        and(
          eq(schema.boards.teamId, teamId),
          eq(schema.boards.status, archived ? 'archived' : 'active'),
        ),
      )
      .groupBy(schema.boards.id)
      .orderBy(sql`${schema.boards.updatedAt} desc`);
    return rows.map(({ board, itemCount }) => ({ ...this.toBoard(board), itemCount }));
  }

  async listItems(boardId: string): Promise<BoardItem[]> {
    const rows = await this.db
      .select()
      .from(schema.boardItems)
      .where(eq(schema.boardItems.boardId, boardId));
    return rows.map((row) => this.toItem(row));
  }

  async listEdges(boardId: string): Promise<BoardEdge[]> {
    const rows = await this.db
      .select()
      .from(schema.boardEdges)
      .where(eq(schema.boardEdges.boardId, boardId));
    return rows.map((row) => this.toEdge(row));
  }

  async updateTitle(boardId: string, title: string): Promise<Board | null> {
    const [row] = await this.db
      .update(schema.boards)
      .set({ title, updatedAt: new Date() })
      .where(eq(schema.boards.id, boardId))
      .returning();
    return row ? this.toBoard(row) : null;
  }

  /** Архивация — доска пропадает из основных списков, но не удаляется */
  async archiveBoard(boardId: string): Promise<Board | null> {
    const [row] = await this.db
      .update(schema.boards)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(schema.boards.id, boardId), eq(schema.boards.status, 'active')))
      .returning();
    return row ? this.toBoard(row) : null;
  }

  async unarchiveBoard(boardId: string): Promise<Board | null> {
    const [row] = await this.db
      .update(schema.boards)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(eq(schema.boards.id, boardId), eq(schema.boards.status, 'archived')))
      .returning();
    return row ? this.toBoard(row) : null;
  }

  /** Настоящее удаление — необратимо, элементы и связи уходят каскадом */
  async deleteBoard(boardId: string): Promise<void> {
    await this.db.delete(schema.boards).where(eq(schema.boards.id, boardId));
  }

  private toBoard(row: typeof schema.boards.$inferSelect): Board {
    return {
      id: row.id,
      teamId: row.teamId,
      ownerId: row.ownerId,
      title: row.title,
      status: row.status,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toItem(row: typeof schema.boardItems.$inferSelect): BoardItem {
    return {
      id: row.id,
      boardId: row.boardId,
      parentId: row.parentId,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      zIndex: row.zIndex,
      content: row.content,
      style: row.style,
      createdBy: row.createdBy,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toEdge(row: typeof schema.boardEdges.$inferSelect): BoardEdge {
    return {
      id: row.id,
      boardId: row.boardId,
      sourceItemId: row.sourceItemId,
      targetItemId: row.targetItemId,
      sourceHandle: row.sourceHandle,
      targetHandle: row.targetHandle,
      label: row.label,
      style: row.style,
    };
  }
}
