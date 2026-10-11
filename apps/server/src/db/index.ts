import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/**
 * Создаёт пул подключений и Drizzle-клиент.
 * Подключение к приложению Fastify выполняется в задаче 2.1.
 */
export function createDb(
  connectionString: string,
  /**
   * Размер пула. Действие за столом/доской берёт соединение дважды: запись под
   * блокировкой и снимок для рассылки. Нагрузочным тестом 21.10
   * (docs/board-load-test-report.md) на доске с 50 одновременными участниками пул
   * из 30 оказался фактически исчерпан — отсюда 50 по умолчанию. Postgres по
   * умолчанию допускает до 100 подключений НА ВСЕХ: у нескольких экземпляров
   * сервера (10.18) сумма пулов должна туда помещаться — см. DATABASE_POOL_MAX
   */
  poolMax = 50,
): { db: Db; pool: Pool } {
  const pool = new Pool({
    connectionString,
    max: poolMax,
    // Не ждать вечно при «тихом» падении сети: health должен отвечать 503, а не висеть
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };
export { isForeignKeyViolation, isUniqueViolation } from './errors';
