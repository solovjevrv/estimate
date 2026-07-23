export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Origin дев-фронта для CORS Socket.io; в проде фронт same-origin через nginx */
  webOrigin: string;
}

export function loadConfig(): Config {
  // Локальная разработка: переменные из .env в корне монорепы.
  // Уже заданные переменные окружения имеют приоритет (loadEnvFile их не перезаписывает).
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // .env отсутствует (контейнер, CI) — переменные приходят из окружения
  }

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
