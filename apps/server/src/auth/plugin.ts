import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyOauth2, { type OAuth2Namespace } from '@fastify/oauth2';
import fastifyRateLimit from '@fastify/rate-limit';
import { AUTH_PROVIDERS, type AuthProvider } from '@poker/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify'; // eslint-disable-line @typescript-eslint/no-unused-vars
import fp from 'fastify-plugin';

import type { AuthConfig } from '../config';
import { DOCS_TAGS, errorResponse } from '../http/openapi';

import { AuthController, type ProfileBody } from './auth.controller';
import { AuthService } from './auth.service';
import { Authenticator } from './authenticator';
import { OAUTH_PROVIDERS } from './providers';
import { SessionsRepository } from './sessions.repository';
import { TokenService } from './token.service';
import { UsersRepository } from './users.repository';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * preHandler аутентификации. Опционален: приложение можно собрать
     * и без настроек входа (например, в тестах).
     */
    authenticate?: (req: FastifyRequest) => Promise<void>;
    /**
     * Как authenticate, но не требует куку — для роутов, куда может зайти
     * и гость (доски по ссылке, 14.4). Устанавливает req.actorId = null для анонима.
     */
    identify?: (req: FastifyRequest) => Promise<void>;
    /** Нужен Socket.io, который читает сессию из сырого заголовка Cookie */
    tokens?: TokenService;
    googleOauth2?: OAuth2Namespace;
    yandexOauth2?: OAuth2Namespace;
  }

  interface FastifyRequest {
    /**
     * actorId для роутов с опциональным входом (доски по ссылке, 14.4) —
     * null, если гость. Не путать с req.user (только для полностью
     * авторизованных роутов, где стоит preHandler authenticate).
     */
    actorId?: string | null;
  }
}

export interface AuthPluginOptions {
  auth: AuthConfig;
}

/** Имя декоратора, под которым @fastify/oauth2 регистрирует провайдера */
function namespaceOf(provider: AuthProvider): 'googleOauth2' | 'yandexOauth2' {
  return `${provider}Oauth2`;
}

/** Публичный профиль в ответах — описан один раз и переиспользуется схемами (в т.ч. avatar.plugin.ts) */
export const userResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    provider: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string' },
    jobTitle: { type: ['string', 'null'] },
    avatarUrl: { type: ['string', 'null'] },
  },
} as const;

const profileBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    jobTitle: { type: 'string' },
  },
} as const;

/** Таймаут запроса к token endpoint провайдера, мс */
const TOKEN_REQUEST_TIMEOUT_MS = 5_000;

/** Страховка от перебора и накрутки запросов к OAuth-провайдеру (7.8) */
const AUTH_RATE_LIMIT_MAX = 20;
const AUTH_RATE_LIMIT_WINDOW = '1 minute';

async function authPluginImpl(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  const config = opts.auth;

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: config.jwtSecret });

  const tokens = new TokenService(app.jwt, config.cookieSecure);
  const service = new AuthService(
    new UsersRepository(app.db),
    new SessionsRepository(app.db),
    tokens,
  );
  const authenticator = new Authenticator(tokens);

  const enabledProviders = AUTH_PROVIDERS.filter((provider) => config.providers[provider]);
  if (enabledProviders.length === 0) {
    app.log.warn('OAuth-провайдеры не настроены: вход в приложение недоступен');
  }

  const controller = new AuthController(service, tokens, config, enabledProviders);

  app.decorate('authenticate', authenticator.handle);
  app.decorate('identify', authenticator.identify);
  app.decorate('tokens', tokens);

  app.get(
    '/api/me',
    {
      preHandler: authenticator.handle,
      schema: {
        tags: [DOCS_TAGS.auth],
        summary: 'Профиль текущего пользователя',
        security: [{ session: [] }],
        response: {
          200: { description: 'Профиль', type: 'object', properties: { user: userResponse } },
          401: { description: 'Сессии нет или она истекла', ...errorResponse },
        },
      },
    },
    controller.me,
  );

  app.patch<{ Body: ProfileBody }>(
    '/api/me',
    {
      preHandler: authenticator.handle,
      schema: {
        tags: [DOCS_TAGS.auth],
        summary: 'Изменить имя и должность в профиле',
        security: [{ session: [] }],
        body: profileBody,
        response: {
          200: {
            description: 'Профиль обновлён',
            type: 'object',
            properties: { user: userResponse },
          },
          400: {
            description: 'Имя пустое/слишком длинное или должность слишком длинная',
            ...errorResponse,
          },
          401: { description: 'Требуется вход', ...errorResponse },
        },
      },
    },
    controller.updateProfile,
  );

  /**
   * Всё под /api/auth/* — в отдельном вложенном контексте (без fp): так у
   * лимитера свои границы и он не начинает считать заодно /api/me и весь
   * остальной API (7.8). @fastify/oauth2 сам не создаёт дочерний контекст
   * (обёрнут в fp), поэтому его decorator/маршрут регистрируются здесь же,
   * под тем же лимитом.
   */
  await app.register(async (auth) => {
    await auth.register(fastifyRateLimit, {
      max: AUTH_RATE_LIMIT_MAX,
      timeWindow: AUTH_RATE_LIMIT_WINDOW,
      // Свой бюджет на каждый маршрут, а не один общий на весь /api/auth/*:
      // иначе безобидный список провайдеров делил бы лимит с обменом токена
      keyGenerator: (req) => `${req.ip}:${req.routeOptions.url ?? req.url}`,
      // Сообщение на русском (единообразно с остальными ошибками); код/статус
      // единый обработчик (http/error-handler.ts) достаёт сам из statusCode
      errorResponseBuilder: (_req, context) => {
        const err = new Error(`Слишком много запросов, повторите через ${context.after}`);
        (err as Error & { statusCode: number }).statusCode = context.statusCode;
        return err;
      },
    });

    auth.get(
      '/api/auth/providers',
      {
        schema: {
          tags: [DOCS_TAGS.auth],
          summary: 'Доступные способы входа',
          description: 'Провайдер попадает в список, если для него заданы ключи в окружении.',
          response: {
            200: {
              description: 'Список включённых провайдеров',
              type: 'object',
              properties: {
                providers: { type: 'array', items: { type: 'string', enum: [...AUTH_PROVIDERS] } },
              },
            },
          },
        },
      },
      controller.listProviders,
    );

    auth.post(
      '/api/auth/refresh',
      {
        schema: {
          tags: [DOCS_TAGS.auth],
          summary: 'Продлить сессию',
          description: 'Обменивает refresh-куку на новую пару токенов и обновляет обе куки.',
          security: [{ refresh: [] }],
          response: {
            200: {
              description: 'Сессия продлена',
              type: 'object',
              properties: { user: userResponse },
            },
            401: { description: 'Refresh-кука недействительна', ...errorResponse },
          },
        },
      },
      controller.refresh,
    );

    auth.post(
      '/api/auth/logout',
      {
        schema: {
          tags: [DOCS_TAGS.auth],
          summary: 'Выйти',
          description: 'Гасит куки сессии в браузере.',
          response: { 204: { description: 'Куки сброшены', type: 'null' } },
        },
      },
      controller.logout,
    );

    for (const name of enabledProviders) {
      const credentials = config.providers[name];
      if (!credentials) continue;
      const provider = OAUTH_PROVIDERS[name];

      await auth.register(fastifyOauth2, {
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
        // Принудительный выбор аккаунта на экране провайдера (7.19)
        callbackUriParams: provider.authorizeParams,
        tags: [DOCS_TAGS.auth],
        schema: {
          tags: [DOCS_TAGS.auth],
          summary: `Начать вход через ${name === 'google' ? 'Google' : 'Яндекс'}`,
          description: 'Редирект на экран согласия провайдера.',
          response: { 302: { description: 'Редирект к провайдеру', type: 'null' } },
        },
        pkce: 'S256',
        cookie: { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure },
      });

      const namespace = auth[namespaceOf(name)];
      if (!namespace) {
        throw new Error(`Провайдер ${name} не инициализирован`);
      }
      // oauth2 декорирует вложенный контекст `auth` — снаружи (Socket.io, тесты)
      // провайдер ищут через `app`, поэтому пробрасываем декоратор туда же
      app.decorate(namespaceOf(name), namespace);
      auth.get(
        `/api/auth/${name}/callback`,
        {
          schema: {
            tags: [DOCS_TAGS.auth],
            summary: `Возврат от ${name === 'google' ? 'Google' : 'Яндекса'}`,
            description:
              'Обменивает код на токен, заводит или обновляет пользователя, ' +
              'выставляет куки сессии и возвращает браузер на фронт.',
            response: { 302: { description: 'Редирект на фронт', type: 'null' } },
          },
        },
        controller.createCallbackHandler(provider, namespace),
      );
    }
  });
}

export const authPlugin = fp(authPluginImpl, { name: 'poker-auth' });
