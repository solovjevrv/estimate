import { defineConfig } from 'drizzle-kit';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Переменные окружения для локальной разработки лежат в .env в корне монорепы
try {
  process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'));
} catch {
  // .env отсутствует (например, в CI) — переменные должны прийти из окружения
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://estimate:estimate@localhost:5432/estimate',
  },
});
