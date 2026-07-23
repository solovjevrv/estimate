import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Применяет миграции из папки drizzle/ (лежит рядом с dist в рабочей директории).
 * Используется при деплое перед перезапуском приложения.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL не задан');
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  await migrate(db, { migrationsFolder: './drizzle' });
  await pool.end();

  console.log('Миграции применены');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
