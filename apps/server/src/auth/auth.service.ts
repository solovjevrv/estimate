import type { AuthProvider, AuthUser } from '@poker/shared';

import { UnauthorizedError } from '../errors';

import type { OAuthProfile } from './providers';
import type { SessionTokens, TokenService } from './token.service';
import type { UsersRepository } from './users.repository';

export interface Session {
  user: AuthUser;
  tokens: SessionTokens;
}

/** Сценарии входа: завершение OAuth-флоу, продление и чтение текущей сессии */
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly tokens: TokenService,
  ) {}

  async completeOAuthLogin(provider: AuthProvider, profile: OAuthProfile): Promise<Session> {
    const user = await this.users.upsertFromOAuth(provider, profile);
    return { user, tokens: this.tokens.issue(user.id) };
  }

  /** Профиль владельца access-токена; аккаунт мог быть удалён — тогда сессия недействительна */
  async currentUser(userId: string): Promise<AuthUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedError();
    }
    return user;
  }

  /**
   * Обмен refresh-токена на новую пару. Отзыва старого токена пока нет:
   * он остаётся валидным до конца TTL (список сессий в БД — задача 7.6).
   */
  async refresh(refreshToken: string | undefined): Promise<Session> {
    const userId = refreshToken ? this.tokens.verify(refreshToken, 'refresh') : null;
    const user = userId ? await this.users.findById(userId) : null;
    if (!user) {
      throw new UnauthorizedError('Сессия истекла');
    }
    return { user, tokens: this.tokens.issue(user.id) };
  }
}
