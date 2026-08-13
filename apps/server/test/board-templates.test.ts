/**
 * Тесты репозитория шаблонов досок (15.1) на реальной PostgreSQL: сидирование
 * встроенных шаблонов идемпотентно, listBuiltin возвращает 4 строки с непустым items.
 * Без DATABASE_URL — пропускаются.
 */
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BOARD_TEMPLATE_SEEDS } from '../src/boards/board-templates-seed-data';
import { BoardTemplatesRepository } from '../src/boards/board-templates.repository';
import { createDb, schema } from '../src/db';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb('репозиторий шаблонов досок', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let repository: BoardTemplatesRepository;

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl as string));
    repository = new BoardTemplatesRepository(db);
    // Сидируем перед тестами, чтобы listBuiltin имел данные
    await repository.seedBuiltins(BOARD_TEMPLATE_SEEDS);
  });

  afterAll(async () => {
    await db
      .delete(schema.boardTemplates)
      .where(eq(schema.boardTemplates.scope, 'builtin'));
    await pool?.end();
  });

  it('seedBuiltins идемпотентен: повторный вызов не плодит дубли и не падает', async () => {
    const before = await db
      .select()
      .from(schema.boardTemplates)
      .where(eq(schema.boardTemplates.scope, 'builtin'));

    await repository.seedBuiltins(BOARD_TEMPLATE_SEEDS);
    await repository.seedBuiltins(BOARD_TEMPLATE_SEEDS);

    const after = await db
      .select()
      .from(schema.boardTemplates)
      .where(eq(schema.boardTemplates.scope, 'builtin'));

    // Количество строк не должно вырасти
    expect(after).toHaveLength(before.length);
    expect(after).toHaveLength(4);
  });

  it('listBuiltin возвращает 4 строки с непустым items', async () => {
    const templates = await repository.listBuiltin();

    expect(templates).toHaveLength(4);
    for (const template of templates) {
      expect(template.items).toBeDefined();
      expect(template.items.length).toBeGreaterThan(0);
      expect(template.scope).toBe('builtin');
      expect(template.name).toBeTruthy();
    }

    const ids = templates.map((t) => t.id).sort();
    expect(ids).toEqual([...BOARD_TEMPLATE_SEEDS.map((s) => s.id)].sort());
  });
});
