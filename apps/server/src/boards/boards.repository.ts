import type { Board, BoardEdge, BoardItem } from '@estimate/shared';
import { type BoardShareRole } from '@estimate/shared';
import { and, eq, sql } from 'drizzle-orm';

import { schema } from '../db';
import type { DbExecutor } from '../common/db-executor';
export type { DbExecutor };

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

  async updateShareRole(boardId: string, shareRole: BoardShareRole | null): Promise<Board | null> {
    const [row] = await this.db
      .update(schema.boards)
      .set({ shareRole, updatedAt: new Date() })
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

  /**
   * Отмечает, что содержимое доски изменилось: по этому номеру клиент
   * отбрасывает отставшие рассылки и ориентируется при догоне (12.4).
   */
  async bumpRevision(boardId: string): Promise<number> {
    const [row] = await this.db
      .update(schema.boards)
      .set({ revision: sql`${schema.boards.revision} + 1`, updatedAt: new Date() })
      .where(eq(schema.boards.id, boardId))
      .returning({ revision: schema.boards.revision });
    if (!row) {
      throw new Error('Не удалось обновить ревизию доски');
    }
    return row.revision;
  }

  /**
   * Id элемента приходит от клиента (UUID) — операция создания задаёт его сама,
   * не сервер (12.4). Поля перечисляются явно, а не через `{ ...item }`: вызывающий
   * код (`BoardsService.applyOps`) строит `item` из `BoardOpState`, а там это
   * полноценный `BoardItem` с `updatedAt`-строкой — спред затолкал бы её в
   * колонку типа `timestamp`, ожидающую `Date`.
   */
  async insertItem(
    boardId: string,
    createdBy: string | null,
    item: Omit<BoardItem, 'boardId' | 'createdBy' | 'updatedAt'>,
  ): Promise<BoardItem> {
    const { id, parentId, x, y, width, height, rotation, zIndex, content, style, reactions } = item;
    const [row] = await this.db
      .insert(schema.boardItems)
      .values({
        id,
        boardId,
        parentId,
        x,
        y,
        width,
        height,
        rotation,
        zIndex,
        content,
        style,
        reactions,
        createdBy,
      })
      .returning();
    if (!row) {
      throw new Error('Не удалось создать элемент доски');
    }
    return this.toItem(row);
  }

  /**
   * Принимает уже провалидированную и слитую с текущей запись целиком (не
   * патч) — так же, как `insertItem`. Поля перечисляются явно, а не через
   * `{ ...item }`: `item` на входе может нести и служебные поля вроде `id`/
   * `boardId`/`createdBy` (это полноценный `BoardItem` из `BoardOpState`),
   * и спред затолкал бы их в `SET` — включая `boardId`, которым можно было бы
   * перевесить чужую строку на произвольную доску мимо всех прав (12.4).
   */
  async updateItem(
    boardId: string,
    itemId: string,
    item: Pick<
      BoardItem,
      | 'parentId'
      | 'x'
      | 'y'
      | 'width'
      | 'height'
      | 'rotation'
      | 'zIndex'
      | 'content'
      | 'style'
      | 'reactions'
    >,
  ): Promise<BoardItem | null> {
    const { parentId, x, y, width, height, rotation, zIndex, content, style, reactions } = item;
    const [row] = await this.db
      .update(schema.boardItems)
      .set({
        parentId,
        x,
        y,
        width,
        height,
        rotation,
        zIndex,
        content,
        style,
        reactions,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.boardItems.id, itemId), eq(schema.boardItems.boardId, boardId)))
      .returning();
    return row ? this.toItem(row) : null;
  }

  async deleteItem(boardId: string, itemId: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.boardItems)
      .where(and(eq(schema.boardItems.id, itemId), eq(schema.boardItems.boardId, boardId)))
      .returning({ id: schema.boardItems.id });
    return rows.length > 0;
  }

  /** Поля перечисляются явно — та же причина, что у `insertItem` выше */
  async insertEdge(boardId: string, edge: Omit<BoardEdge, 'boardId'>): Promise<BoardEdge> {
    const { id, sourceItemId, targetItemId, sourceHandle, targetHandle, label, style, zIndex } =
      edge;
    const [row] = await this.db
      .insert(schema.boardEdges)
      .values({
        id,
        boardId,
        sourceItemId,
        targetItemId,
        sourceHandle,
        targetHandle,
        label,
        style,
        zIndex,
      })
      .returning();
    if (!row) {
      throw new Error('Не удалось создать связь доски');
    }
    return this.toEdge(row);
  }

  /** Принимает провалидированную запись целиком — та же причина, что у `updateItem` выше.
   *  sourceItemId/targetItemId — ручное перецепление конца связи (12.20).
   *  zIndex — передний/задний план связи (12.21). */
  async updateEdge(
    boardId: string,
    edgeId: string,
    edge: Pick<
      BoardEdge,
      | 'sourceItemId'
      | 'targetItemId'
      | 'sourceHandle'
      | 'targetHandle'
      | 'label'
      | 'style'
      | 'zIndex'
    >,
  ): Promise<BoardEdge | null> {
    const { sourceItemId, targetItemId, sourceHandle, targetHandle, label, style, zIndex } = edge;
    const [row] = await this.db
      .update(schema.boardEdges)
      .set({ sourceItemId, targetItemId, sourceHandle, targetHandle, label, style, zIndex })
      .where(and(eq(schema.boardEdges.id, edgeId), eq(schema.boardEdges.boardId, boardId)))
      .returning();
    return row ? this.toEdge(row) : null;
  }

  async deleteEdge(boardId: string, edgeId: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.boardEdges)
      .where(and(eq(schema.boardEdges.id, edgeId), eq(schema.boardEdges.boardId, boardId)))
      .returning({ id: schema.boardEdges.id });
    return rows.length > 0;
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
      shareRole: row.shareRole,
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
      reactions: row.reactions,
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
      zIndex: row.zIndex,
    };
  }
}
