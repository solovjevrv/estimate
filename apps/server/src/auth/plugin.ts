import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyOauth2, { type OAuth2Namespace } from '@fastify/oauth2';
import { AUTH_PROVIDERS, type AuthProvider } from '@poker/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { AuthConfig } from '../config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Authenticator } from './authenticator';
import { OAUTH_PROVIDERS } from './providers';
import { TokenService } from './token.service';
import { UsersRepository } from './users.repository';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * preHandler аутентификации. Опционален: приложение можно собрать
     * и без настроек входа (например, в тестах).
     */
    authenticate?: (req: FastifyRequest) => Promise<void>;
    /** Нужен Socket.io, который читает сессию из сырого заголовка Cookie */
    tokens?: TokenService;
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

/** Таймаут запроса к token endpoint провайдера, мс */
const TOKEN_REQUEST_TIMEOUT_MS = 5_000;

async function authPluginImpl(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  const config = opts.auth;

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: config.jwtSecret });

  const tokens = new TokenService(app.jwt, config.cookieSecure);
  const service = new AuthService(new UsersRepository(app.db), tokens);
  const authenticator = new Authenticator(tokens);

  const enabledProviders = AUTH_PROVIDERS.filter((provider) => config.providers[provider]);
  if (enabledProviders.length === 0) {
    app.log.warn('OAuth-провайдеры не настроены: вход в приложение недоступен');
  }

  const controller = new AuthController(service, tokens, config, enabledProviders);

  app.decorate('authenticate', authenticator.handle);
  app.decorate('tokens', tokens);

  // Ответы про сессию не должны оседать в кэшах браузера и прокси
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/auth/') || req.url === '/api/me') {
      reply.header('cache-control', 'no-store');
    }
  });

  app.get('/api/auth/providers', controller.listProviders);
  app.get('/api/me', { preHandler: authenticator.handle }, controller.me);
  app.post('/api/auth/refresh', controller.refresh);
  app.post('/api/auth/logout', controller.logout);

  for (const name of enabledProviders) {
    const credentials = config.providers[name];
    if (!credentials) continue;
    const provider = OAUTH_PROVIDERS[name];

    await app.register(fastifyOauth2, {
      name: namespaceOf(name),
      scope: provider.scope,
      credentials: {
        client: { id: credentials.clientId, secret: credentials.clientSecret },
        auth: provider.configuration,
        // Зависший token endpoint не должен держать обработчик бесконечно
        http: { timeout: TOKEN_REQUEST_TIMEOUT_MS },
      },
      // Должен в точности совпадать с redirect URI, прописанным в кабинете провайдера
      callbackUri: `${config.publicOrigin}/api/auth/${name}/callback`,
      startRedirectPath: `/api/auth/${name}`,
      pkce: 'S256',
      cookie: { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure },
    });

    const namespace = app[namespaceOf(name)];
    if (!namespace) {
      throw new Error(`Провайдер ${name} не инициализирован`);
    }
    app.get(`/api/auth/${name}/callback`, controller.createCallbackHandler(provider, namespace));
  }
}

export const authPlugin = fp(authPluginImpl, { name: 'poker-auth' });
