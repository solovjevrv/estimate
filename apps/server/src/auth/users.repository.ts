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
    // display_name/job_title сюда намеренно не входят: это правки самого пользователя
    // (9.2), а не данные провайдера — очередной вход не должен их затирать
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

  async updateProfile(
    id: string,
    fields: { name: string; jobTitle: string | null },
  ): Promise<AuthUser> {
    const [row] = await this.db
      .update(schema.users)
      .set({ displayName: fields.name, jobTitle: fields.jobTitle })
      .where(eq(schema.users.id, id))
      .returning();

    if (!row) {
      throw new Error('Пользователь не найден');
    }
    return this.toAuthUser(row);
  }

  private toAuthUser(row: typeof schema.users.$inferSelect): AuthUser {
    return {
      id: row.id,
      provider: row.provider,
      email: row.email,
      // Провайдер перезаписывает name при каждом входе — своя правка живёт в displayName
      name: row.displayName ?? row.name,
      jobTitle: row.jobTitle,
      avatarUrl: row.avatarUrl,
    };
  }
}
