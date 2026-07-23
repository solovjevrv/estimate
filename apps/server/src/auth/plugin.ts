import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyOauth2, { type OAuth2Namespace } from '@fastify/oauth2';
import { AUTH_PROVIDERS, type AuthProvider } from '@poker/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { AuthConfig } from '../config';

import { PROVIDER_DEFINITIONS } from './providers';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  setSessionCookies,
  signSession,
  verifySessionToken,
} from './tokens';
import { findUserById, upsertOAuthUser } from './users';

declare module 'fastify' {
  interface FastifyInstance {
    /** Настройки аутентификации (нужны сокет-мидлварам и роутам) */
    authConfig: AuthConfig;
    /** preHandler: пускает дальше только с валидной access-кукой */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    googleOauth2?: OAuth2Namespace;
    yandexOauth2?: OAuth2Namespace;
  }
}

export interface AuthPluginOptions {
  auth: AuthConfig;
}

/** Имя декоратора, под которым @fastify/oauth2 регистрирует провайдера */
function namespaceOf(provider: AuthProvider): 'googleOauth2' | 'yandexOauth2' {
  return `${provider}Oauth2`;
}

async function authPluginImpl(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  const config = opts.auth;

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: config.jwtSecret });

  app.decorate('authConfig', config);

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[ACCESS_COOKIE];
    const userId = token ? verifySessionToken(app.jwt, token, 'access') : null;
    if (!userId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Требуется вход' });
    }
    req.user = { sub: userId, typ: 'access' };
  });

  const enabledProviders = AUTH_PROVIDERS.filter((provider) => config.providers[provider]);
  if (enabledProviders.length === 0) {
    app.log.warn('OAuth-провайдеры не настроены: вход в приложение недоступен');
  }

  app.get('/api/auth/providers', async () => ({ providers: enabledProviders }));

  app.get(
    '/api/me',
    { preHandler: (req, reply) => app.authenticate(req, reply) },
    async (req, reply) => {
      const user = await findUserById(app.db, req.user.sub);
      if (!user) {
        // Пользователя удалили, а кука осталась — гасим сессию
        clearSessionCookies(reply, config.cookieSecure);
        return reply.code(401).send({ error: 'unauthorized', message: 'Требуется вход' });
      }
      return { user };
    },
  );

  app.post('/api/auth/refresh', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    const userId = token ? verifySessionToken(app.jwt, token, 'refresh') : null;
    const user = userId ? await findUserById(app.db, userId) : null;
    if (!user) {
      clearSessionCookies(reply, config.cookieSecure);
      return reply.code(401).send({ error: 'unauthorized', message: 'Сессия истекла' });
    }
    // Ротация: на каждый refresh выдаём новую пару токенов
    setSessionCookies(reply, signSession(app.jwt, user.id), config.cookieSecure);
    return { user };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    clearSessionCookies(reply, config.cookieSecure);
    return reply.code(204).send();
  });

  for (const provider of enabledProviders) {
    const credentials = config.providers[provider];
    if (!credentials) continue;
    const definition = PROVIDER_DEFINITIONS[provider];

    await app.register(fastifyOauth2, {
      name: namespaceOf(provider),
      scope: definition.scope,
      credentials: {
        client: { id: credentials.clientId, secret: credentials.clientSecret },
        auth: definition.configuration,
      },
      // Должен в точности совпадать с redirect URI, прописанным в кабинете провайдера
      callbackUri: `${config.publicOrigin}/api/auth/${provider}/callback`,
      startRedirectPath: `/api/auth/${provider}`,
      pkce: 'S256',
      cookie: { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure },
    });

    app.get(`/api/auth/${provider}/callback`, async (req, reply) => {
      try {
        const oauth = app[namespaceOf(provider)];
        if (!oauth) {
          throw new Error(`Провайдер ${provider} не инициализирован`);
        }
        const { token } = await oauth.getAccessTokenFromAuthorizationCodeFlow(req, reply);
        const profile = await definition.fetchProfile(token.access_token);
        const user = await upsertOAuthUser(app.db, provider, profile);

        setSessionCookies(reply, signSession(app.jwt, user.id), config.cookieSecure);
        return reply.redirect(`${config.webOrigin}/`);
      } catch (err) {
        // Наружу не отдаём ничего, кроме признака ошибки: детали только в логах
        req.log.error({ err, provider }, 'OAuth: не удалось завершить вход');
        return reply.redirect(`${config.webOrigin}/login?error=oauth`);
      }
    });
  }
}

export const authPlugin = fp(authPluginImpl, { name: 'poker-auth' });

/**
 * Достаёт id пользователя из cookie-заголовка (нужно Socket.io-подключениям,
 * которые не проходят через роутинг Fastify). Гость получает null.
 */
export function readUserIdFromCookieHeader(
  app: FastifyInstance,
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader || !app.hasDecorator('jwt')) {
    return null;
  }
  const token = fastifyCookie.parse(cookieHeader)[ACCESS_COOKIE];
  return token ? verifySessionToken(app.jwt, token, 'access') : null;
}
