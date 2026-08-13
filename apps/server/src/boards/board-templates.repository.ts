import { asc, eq } from 'drizzle-orm';

import type { BoardTemplate } from '@poker/shared';

import type { Db } from '../db';
import { boardTemplates } from '../db/schema';

import type { BoardTemplateSeedRow } from './board-templates-seed-data';

export class BoardTemplatesRepository {
  constructor(private readonly db: Db) {}

  /** Идемпотентно: повторный вызов при каждом старте сервера — no-op после первого раза */
  async seedBuiltins(rows: BoardTemplateSeedRow[]): Promise<void> {
    await this.db
      .insert(boardTemplates)
      .values(
        rows.map((r) => ({
          id: r.id,
          scope: 'builtin' as const,
          ownerId: null,
          teamId: null,
          name: r.name,
          nameKey: r.nameKey,
          description: r.description,
          descriptionKey: r.descriptionKey,
          items: r.items,
        })),
      )
      .onConflictDoNothing({ target: boardTemplates.id });
  }

  async listBuiltin(): Promise<BoardTemplate[]> {
    const rows = await this.db
      .select()
      .from(boardTemplates)
      .where(eq(boardTemplates.scope, 'builtin'))
      .orderBy(asc(boardTemplates.createdAt));
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
