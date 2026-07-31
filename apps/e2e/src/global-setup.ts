import { fileURLToPath } from 'node:url';

import { createDb } from '@poker/server/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/** Накатывает миграции один раз перед всем прогоном — тесты сами БД не трогают */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL не задан — нужна тестовая PostgreSQL для E2E');
  }

  const { db, pool } = createDb(databaseUrl);
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../server/drizzle', import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}
