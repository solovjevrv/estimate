import { eq } from 'drizzle-orm';

import type { Db } from '../db';
import { schema } from '../db';

/** Транзакция Drizzle: тот же интерфейс запросов, что и у соединения */
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbExecutor = Db | Transaction;

/** Совпадает с TTL refresh-токена (`token.service.ts`) — строка живёт ровно столько же, сколько токен */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionRow {
  id: string;
  userId: string;
}

/**
 * Активные refresh-сессии пользователей. Id строки — jti внутри refresh-JWT:
 * без строки в этой таблице токен с виду валидной подписью и сроком жизни
 * всё равно не пройдёт обмен (7.6).
 */
export class SessionsRepository {
  constructor(private readonly db: DbExecutor) {}

  async create(userId: string): Promise<SessionRow> {
    const [row] = await this.db
      .insert(schema.sessions)
      .values({ userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .returning();
    if (!row) {
      throw new Error('Не удалось создать сессию');
    }
    return { id: row.id, userId: row.userId };
  }

  /**
   * Обмен refresh-токена — одноразовый: старая строка удаляется, новая
   * заводится на её место. Если `jti` не нашёлся (уже использован или
   * пользователь вышел), обмен отклоняется — это и есть отзыв сессии.
   */
  async rotate(jti: string, userId: string): Promise<SessionRow | null> {
    const [deleted] = await this.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, jti))
      .returning();
    if (!deleted || deleted.userId !== userId) {
      return null;
    }
    return this.create(userId);
  }

  /** Выход: гасим ровно эту сессию, остальные устройства пользователя не трогаем */
  async revoke(jti: string): Promise<void> {
    await this.db.delete(schema.sessions).where(eq(schema.sessions.id, jti));
  }
}
