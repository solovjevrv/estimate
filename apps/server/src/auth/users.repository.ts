import type { AuthProvider, AuthUser } from '@poker/shared';
import { eq } from 'drizzle-orm';

import type { Db } from '../db';
import { schema } from '../db';

import type { OAuthProfile } from './providers';

export class UsersRepository {
  constructor(private readonly db: Db) {}

  /**
   * Создаёт пользователя при первом входе, при повторном — обновляет профиль
   * (имя/почта/аватар могли поменяться у провайдера).
   * Аккаунты разных провайдеров не связываются даже при совпадении email —
   * решение зафиксировано в задаче 2.2.
   */
  async upsertFromOAuth(provider: AuthProvider, profile: OAuthProfile): Promise<AuthUser> {
    const [row] = await this.db
      .insert(schema.users)
      .values({
        provider,
        providerId: profile.providerId,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      })
      .onConflictDoUpdate({
        target: [schema.users.provider, schema.users.providerId],
        set: { email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl },
      })
      .returning();

    if (!row) {
      throw new Error('Не удалось сохранить пользователя');
    }
    return this.toAuthUser(row);
  }

  async findById(id: string): Promise<AuthUser | null> {
    const [row] = await this.db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return row ? this.toAuthUser(row) : null;
  }

  private toAuthUser(row: typeof schema.users.$inferSelect): AuthUser {
    return {
      id: row.id,
      provider: row.provider,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatarUrl,
    };
  }
}
