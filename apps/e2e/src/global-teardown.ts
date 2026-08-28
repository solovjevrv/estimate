import { createDb, schema } from '@estimate/server/db';
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
    // У teams нет внешнего ключа на users — удаление пользователя-создателя не каскадирует
    // саму команду (только его членство), поэтому команда чистится отдельно по тому же маркеру
    await db.delete(schema.teams).where(like(schema.teams.name, `${E2E_ROOM_PREFIX}%`));
    // У boards.owner_id — onDelete 'set null' (не cascade, см. schema.ts), поэтому доски
    // тоже чистятся отдельно по маркеру в названии, иначе осиротевшие ряды копились бы вечно
    await db.delete(schema.boards).where(like(schema.boards.title, `${E2E_ROOM_PREFIX}%`));
    await db.delete(schema.users).where(like(schema.users.email, `%@${E2E_EMAIL_DOMAIN}`));
  } finally {
    await pool.end();
  }
}
