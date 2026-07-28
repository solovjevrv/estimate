import {
  type AuthProvider,
  type AuthUser,
  USER_JOB_TITLE_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
} from '@poker/shared';

import { UnauthorizedError, ValidationError } from '../errors';

import type { OAuthProfile } from './providers';
import type { SessionsRepository } from './sessions.repository';
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
    private readonly sessions: SessionsRepository,
    private readonly tokens: TokenService,
  ) {}

  async completeOAuthLogin(provider: AuthProvider, profile: OAuthProfile): Promise<Session> {
    const user = await this.users.upsertFromOAuth(provider, profile);
    const session = await this.sessions.create(user.id);
    return { user, tokens: this.tokens.issue(user.id, session.id) };
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
   * Обмен refresh-токена на новую пару. Токен одноразовый: строка в `sessions`
   * под его `jti` удаляется и заводится заново — повторное предъявление того
   * же (например, украденного и уже использованного законным владельцем)
   * токена ничего не даст, обмен отклонится (7.6).
   */
  async refresh(refreshToken: string | undefined): Promise<Session> {
    const parsed = refreshToken ? this.tokens.verifyRefresh(refreshToken) : null;
    if (!parsed) {
      throw new UnauthorizedError('Сессия истекла');
    }
    const rotated = await this.sessions.rotate(parsed.jti, parsed.userId);
    if (!rotated) {
      throw new UnauthorizedError('Сессия истекла');
    }
    const user = await this.users.findById(parsed.userId);
    if (!user) {
      throw new UnauthorizedError();
    }
    return { user, tokens: this.tokens.issue(user.id, rotated.id) };
  }

  /** Выход: гасим сессию, к которой относится refresh-кука — остальные устройства не трогаем */
  async logout(refreshToken: string | undefined): Promise<void> {
    const parsed = refreshToken ? this.tokens.verifyRefresh(refreshToken) : null;
    if (parsed) {
      await this.sessions.revoke(parsed.jti);
    }
  }

  /** Правка отображаемого имени и должности — оба поля сохраняются одним запросом со страницы профиля */
  async updateProfile(
    userId: string,
    fields: { name: string; jobTitle?: string },
  ): Promise<AuthUser> {
    const name = fields.name.trim();
    if (name.length < 1 || name.length > USER_NAME_MAX_LENGTH) {
      throw new ValidationError(`Имя должно быть от 1 до ${USER_NAME_MAX_LENGTH} символов`);
    }

    const jobTitleRaw = fields.jobTitle?.trim() ?? '';
    if (jobTitleRaw.length > USER_JOB_TITLE_MAX_LENGTH) {
      throw new ValidationError(`Должность — не более ${USER_JOB_TITLE_MAX_LENGTH} символов`);
    }
    // Пустая должность — это «не заполнено», а не пустая строка в БД
    const jobTitle = jobTitleRaw.length > 0 ? jobTitleRaw : null;

    return this.users.updateProfile(userId, { name, jobTitle });
  }
}
