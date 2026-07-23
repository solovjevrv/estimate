/**
 * Миграции накатываются один раз на весь прогон. Если это делать в каждом файле
 * тестов, параллельные воркеры дерутся за создание служебной схемы drizzle
 * (на чистой БД получается duplicate key).
 */
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb } from '../src/db';

export async function setup(): Promise<void> {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // нет .env — переменные из окружения (CI)
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // Без БД интеграционные тесты пропускаются, мигрировать нечего
    return;
  }

  const { db, pool } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  } finally {
    await pool.end();
  }
}
