import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Origin дев-фронта для CORS Socket.io; в проде фронт same-origin через nginx */
  webOrigin: string;
}

/**
 * Локальная разработка: ищем .env вверх от cwd (корень монорепы или apps/server).
 * В контейнере/CI файла нет — переменные приходят из окружения.
 * Уже заданные переменные имеют приоритет: loadEnvFile их не перезаписывает.
 */
function loadDotenv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 3; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    dir = dirname(dir);
  }
}

export function loadConfig(): Config {
  loadDotenv();

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Некорректное значение PORT: "${process.env.PORT}"`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL не задан');
  }

  return {
    port,
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl,
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  };
}
