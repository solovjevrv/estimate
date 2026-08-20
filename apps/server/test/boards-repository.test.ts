/**
 * BoardsRepository.updateEdge на реальной PostgreSQL (12.20).
 *
 * Найден живым тестированием реконнекта связи: `applyBoardOp` (board-ops.ts,
 * чистая in-memory логика) и `persistBoardOps` (board-ops-persistence.test.ts,
 * репозиторий замокан) оба «видели» правильный смерженный edge с новыми
 * sourceItemId/targetItemId и передавали его дальше без вопросов — но РЕАЛЬНАЯ
 * реализация `updateEdge` писала в БД только 4 из 6 полей (без sourceItemId/
 * targetItemId, при добавлении реконнекта в 12.20 про них просто забыли).
 * Ни один из моков этого не поймал бы — нужен реальный DB round-trip.
 * Без DATABASE_URL — пропускается.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BoardsRepository } from '../src/boards/boards.repository';
import { createDb, schema } from '../src/db';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb('BoardsRepository.updateEdge', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let repository: BoardsRepository;
  let boardId: string;
  const suffix = randomUUID();

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl as string));
    repository = new BoardsRepository(db);
    const [board] = await db
      .insert(schema.boards)
      .values({ title: `boards-repository-updateEdge-${suffix}` })
      .returning();
    boardId = board!.id;
  });

  afterAll(async () => {
    try {
      if (boardId) await db.delete(schema.boards).where(eq(schema.boards.id, boardId));
    } finally {
      await pool?.end();
    }
  });

  async function insertSticky(): Promise<string> {
    const [row] = await db
      .insert(schema.boardItems)
      .values({
        boardId,
        x: 0,
        y: 0,
        width: 160,
        height: 120,
        content: { type: 'sticky', text: 'Привет' },
        style: { color: '#FCEB96' },
      })
      .returning();
    return row!.id;
  }

  it('перецепляет sourceItemId/targetItemId связи в реальной БД (12.20)', async () => {
    const a = await insertSticky();
    const b = await insertSticky();
    const c = await insertSticky();

    const edge = await repository.insertEdge(boardId, {
      id: randomUUID(),
      sourceItemId: a,
      targetItemId: b,
      sourceHandle: 'right',
      targetHandle: 'left',
      label: null,
      style: { line: 'straight', dash: 'solid', markerStart: 'none', markerEnd: 'none' },
      zIndex: 1,
    });

    const updated = await repository.updateEdge(boardId, edge.id, {
      sourceItemId: a,
      targetItemId: c,
      sourceHandle: 'right',
      targetHandle: 'top',
      label: edge.label,
      style: edge.style,
      zIndex: 42,
    });

    expect(updated).toMatchObject({
      sourceItemId: a,
      targetItemId: c,
      targetHandle: 'top',
      zIndex: 42,
    });

    // Перечитываем отдельным select — подтверждает, что значение реально
    // сохранилось в БД, а не только в возвращённой repository строке.
    const [row] = await db
      .select()
      .from(schema.boardEdges)
      .where(eq(schema.boardEdges.id, edge.id));
    expect(row?.sourceItemId).toBe(a);
    expect(row?.targetItemId).toBe(c);
    expect(row?.targetHandle).toBe('top');
    expect(row?.zIndex).toBe(42);
  });
});
