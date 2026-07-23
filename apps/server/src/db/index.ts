import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/**
 * Создаёт пул подключений и Drizzle-клиент.
 * Подключение к приложению Fastify выполняется в задаче 2.1.
 */
export function createDb(connectionString: string): { db: Db; pool: Pool } {
  const pool = new Pool({
    connectionString,
    // Действие за столом берёт соединение дважды: запись под блокировкой и снимок
    // для рассылки. С запасом на комнату из десятка участников
    max: 30,
    // Не ждать вечно при «тихом» падении сети: health должен отвечать 503, а не висеть
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };
export { isForeignKeyViolation, isUniqueViolation } from './errors';
