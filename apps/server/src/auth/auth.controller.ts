import type { OAuth2Namespace } from '@fastify/oauth2';
import type { AuthProvider } from '@poker/shared';
import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';

import type { AuthConfig } from '../config';
import { UnauthorizedError } from '../errors';

import type { AuthService, Session } from './auth.service';
import type { OAuthProvider } from './providers';
import { REFRESH_COOKIE, type TokenService } from './token.service';

export interface ProfileBody {
  name: string;
  jobTitle?: string;
}

/** Тонкий слой между HTTP и сценариями входа */
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly tokens: TokenService,
    private readonly config: AuthConfig,
    private readonly enabledProviders: readonly AuthProvider[],
  ) {}

  readonly listProviders = async (): Promise<{ providers: readonly AuthProvider[] }> => ({
    providers: this.enabledProviders,
  });

  readonly me = async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    return {
      user: await this.withSessionReset(reply, () => this.service.currentUser(req.user.sub)),
    };
  };

  readonly updateProfile = async (
    req: FastifyRequest<{ Body: ProfileBody }>,
  ): Promise<unknown> => ({
    user: await this.service.updateProfile(req.user.sub, req.body),
  });

  readonly refresh = async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const session = await this.withSessionReset(reply, () =>
      this.service.refresh(req.cookies[REFRESH_COOKIE]),
    );
    this.tokens.setCookies(reply, session.tokens);
    return { user: session.user };
  };

  readonly logout = async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    this.tokens.clearCookies(reply);
    return reply.code(204).send();
  };

  /** Возврат с экрана провайдера: обмен кода на токен, вход и редирект на фронт */
  createCallbackHandler(provider: OAuthProvider, namespace: OAuth2Namespace): RouteHandlerMethod {
    return async (req, reply) => {
      // Пользователь мог просто нажать «Отмена» на экране провайдера — это не ошибка сервера
      const providerError = (req.query as { error?: string } | undefined)?.error;
      if (providerError) {
        req.log.warn(
          { provider: provider.name, providerError },
          'OAuth: провайдер отказал во входе',
        );
        return this.redirectToLoginError(reply);
      }

      let session: Session;
      try {
        const { token } = await namespace.getAccessTokenFromAuthorizationCodeFlow(req, reply);
        const profile = await provider.fetchProfile(token.access_token);
        session = await this.service.completeOAuthLogin(provider.name, profile);
      } catch (err) {
        // Наружу не отдаём ничего, кроме признака ошибки: детали только в логах
        req.log.error({ err, provider: provider.name }, 'OAuth: не удалось завершить вход');
        return this.redirectToLoginError(reply);
      }

      this.tokens.setCookies(reply, session.tokens);
      return reply.redirect(`${this.config.webOrigin}/`);
    };
  }

  /** Если сессия оказалась недействительной, гасим куки — иначе браузер будет ходить с мусором */
  private async withSessionReset<T>(reply: FastifyReply, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.tokens.clearCookies(reply);
      }
      throw err;
    }
  }

  private redirectToLoginError(reply: FastifyReply): FastifyReply {
    return reply.redirect(`${this.config.webOrigin}/login?error=oauth`);
  }
}
