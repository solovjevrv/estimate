import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/**
 * Создаёт пул подключений и Drizzle-клиент.
 * Подключение к приложению Fastify выполняется в задаче 2.1.
 */
export function createDb(connectionString: string): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };
