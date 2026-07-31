import { createDb, schema } from '@poker/server/db';
import { like } from 'drizzle-orm';

import { E2E_EMAIL_DOMAIN, E2E_ROOM_PREFIX } from './fixtures';

/**
 * Комнаты и пользователи, заведённые тестами, чистятся по маркеру (домен почты,
 * префикс имени комнаты) — а не по собранным id, потому что воркеры Playwright
 * живут в разных процессах и не могут поделиться общим списком id между собой.
 */
export default async function globalTeardown(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return;
  }

  const { db, pool } = createDb(databaseUrl);
  try {
    await db.delete(schema.rooms).where(like(schema.rooms.name, `${E2E_ROOM_PREFIX}%`));
    await db.delete(schema.users).where(like(schema.users.email, `%@${E2E_EMAIL_DOMAIN}`));
  } finally {
    await pool.end();
  }
}
