import { defineConfig } from 'drizzle-kit';

// Переменные окружения для локальной разработки лежат в .env в корне монорепы
try {
  process.loadEnvFile('../../.env');
} catch {
  // .env отсутствует (например, в CI) — переменные должны прийти из окружения
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://poker:poker@localhost:5432/poker',
  },
});
