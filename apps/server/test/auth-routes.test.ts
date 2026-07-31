/**
 * Тесты аутентификации на реальной PostgreSQL: upsert пользователя и роуты /api/auth/*.
 * Локально используют БД из docker-compose (корневой .env), в CI — service-контейнер.
 * Без DATABASE_URL — пропускаются.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  SessionsRepository,
  TokenService,
  UsersRepository,
} from '../src/auth';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const authConfig: AuthConfig = {
  jwtSecret: 'секрет-для-тестов-длиннее-тридцати-двух-символов',
  guestSecret: 'гостевой-секрет-для-тестов-длиннее-тридцати-двух',
  publicOrigin: 'http://localhost:3000',
  webOrigin: 'http://localhost:5173',
  cookieSecure: false,
  // Ключи ненастоящие: до сети дело не доходит, проверяется только редирект на провайдера
  providers: { google: { clientId: 'test-client-id', clientSecret: 'test-client-secret' } },
};

/**
 * Пара токенов для указанного экземпляра приложения. `jti` не привязан к
 * строке в `sessions` — годится там, где сама сессия дальше не проверяется
 * (например, отдельная проверка типа токена на /api/me).
 */
function issue(instance: FastifyInstance, userId: string): { access: string; refresh: string } {
  return new TokenService(instance.jwt, false).issue(userId, randomUUID());
}

/** То же самое, но с настоящей строкой в `sessions` — нужна там, где идёт обмен через /api/auth/refresh */
async function issueWithSession(
  instance: FastifyInstance,
  database: ReturnType<typeof createDb>['db'],
  userId: string,
): Promise<{ access: string; refresh: string }> {
  const session = await new SessionsRepository(database).create(userId);
  return new TokenService(instance.jwt, false).issue(userId, session.id);
}

function cookieHeader(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}`;
}

describeDb('аутентификация', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let app: FastifyInstance;
  const createdUserIds: string[] = [];
  const suffix = randomUUID();

  beforeAll(async () => {
    // Миграции уже накачены в test/global-setup.ts
    ({ db, pool } = createDb(databaseUrl as string));
    app = buildApp({ db, auth: authConfig });
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
      if (createdUserIds.length > 0) {
        await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
      }
    } finally {
      await pool?.end();
    }
  });

  async function createUser(overrides: Partial<{ providerId: string; email: string }> = {}) {
    const user = await new UsersRepository(db).upsertFromOAuth('google', {
      providerId: overrides.providerId ?? `google-${suffix}`,
      email: overrides.email ?? `user-${suffix}@example.com`,
      name: 'Тестовый Пользователь',
      avatarUrl: 'https://example.com/avatar.png',
    });
    createdUserIds.push(user.id);
    return user;
  }

  describe('upsert пользователя', () => {
    it('создаёт пользователя при первом входе и обновляет профиль при повторном', async () => {
      const first = await createUser();

      const second = await new UsersRepository(db).upsertFromOAuth('google', {
        providerId: `google-${suffix}`,
        email: `user-${suffix}@example.com`,
        name: 'Новое Имя',
        avatarUrl: null,
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('Новое Имя');
      expect(second.avatarUrl).toBeNull();
    });

    it('отмечает last_login_at при каждом входе, created_at не трогает (7.9)', async () => {
      const providerId = `lastlogin-${suffix}`;
      const created = await createUser({ providerId });
      const [before] = await db.select().from(schema.users).where(eq(schema.users.id, created.id));
      expect(before?.lastLoginAt).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 10));
      await new UsersRepository(db).upsertFromOAuth('google', {
        providerId,
        email: `user-${suffix}@example.com`,
        name: 'Тестовый Пользователь',
        avatarUrl: 'https://example.com/avatar.png',
      });

      const [after] = await db.select().from(schema.users).where(eq(schema.users.id, created.id));
      expect(after!.lastLoginAt.getTime()).toBeGreaterThan(before!.lastLoginAt.getTime());
      expect(after!.createdAt.getTime()).toBe(before!.createdAt.getTime());
    });

    it('правка профиля обновляет updated_at, но не last_login_at (7.9)', async () => {
      const user = await createUser({ providerId: `profile-touch-${suffix}` });
      const [before] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));

      await new Promise((resolve) => setTimeout(resolve, 10));
      await new UsersRepository(db).updateProfile(user.id, { name: 'Другое Имя', jobTitle: null });

      const [after] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
      expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
      expect(after!.lastLoginAt.getTime()).toBe(before!.lastLoginAt.getTime());
    });

    it('одинаковый email у разных провайдеров даёт разных пользователей', async () => {
      const email = `same-${suffix}@example.com`;
      const google = await createUser({ providerId: `g-${suffix}`, email });
      const yandex = await new UsersRepository(db).upsertFromOAuth('yandex', {
        providerId: `y-${suffix}`,
        email,
        name: 'Тот же человек',
        avatarUrl: null,
      });
      createdUserIds.push(yandex.id);

      expect(yandex.id).not.toBe(google.id);
    });
  });

  describe('GET /api/me', () => {
    it('без куки отвечает 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/me' });

      expect(res.statusCode).toBe(401);
    });

    it('с access-кукой отдаёт профиль', async () => {
      const user = await createUser({ providerId: `me-${suffix}` });
      const { access } = issue(app, user.id);

      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, access) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ user: { id: user.id, provider: 'google' } });
    });

    it('refresh-токен не подходит для доступа к API', async () => {
      const user = await createUser({ providerId: `wrong-type-${suffix}` });
      const { refresh } = issue(app, user.id);

      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, refresh) },
      });

      expect(res.statusCode).toBe(401);
    });

    it('при ошибке БД не отдаёт наружу текст запроса', async () => {
      // sub не UUID — запрос к БД падает, ответ должен остаться обезличенным
      const { access } = issue(app, 'не-uuid');

      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, access) },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'internal', message: 'Внутренняя ошибка сервера' });
      expect(res.body).not.toMatch(/select|users/i);
    });

    it('для удалённого пользователя отвечает 401 и гасит куки', async () => {
      const user = await createUser({ providerId: `deleted-${suffix}` });
      const { access } = issue(app, user.id);
      await db.delete(schema.users).where(eq(schema.users.id, user.id));

      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, access) },
      });

      expect(res.statusCode).toBe(401);
      expect(res.cookies.find((c) => c.name === ACCESS_COOKIE)?.value).toBe('');
    });
  });

  describe('PATCH /api/me', () => {
    it('без куки отвечает 401', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me',
        payload: { name: 'Кто-то' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('меняет имя и должность', async () => {
      const user = await createUser({ providerId: `patch-${suffix}` });
      const { access } = issue(app, user.id);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, access) },
        payload: { name: 'Новое Имя', jobTitle: 'Фронтенд-разработчик' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        user: { id: user.id, name: 'Новое Имя', jobTitle: 'Фронтенд-разработчик' },
      });
    });

    it('пустая должность сохраняется как «не заполнено», а не пустая строка', async () => {
      const user = await createUser({ providerId: `patch-empty-job-${suffix}` });
      const { access } = issue(app, user.id);
      await app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, access) },
        payload: { name: 'Имя', jobTitle: 'Аналитик' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, access) },
        payload: { name: 'Имя', jobTitle: '   ' },
      });

      expect(res.json()).toMatchObject({ user: { jobTitle: null } });
    });

    it('пустое имя отклоняется', async () => {
      const user = await createUser({ providerId: `patch-empty-name-${suffix}` });
      const { access } = issue(app, user.id);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, access) },
        payload: { name: '   ' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('слишком длинное имя отклоняется', async () => {
      const user = await createUser({ providerId: `patch-long-name-${suffix}` });
      const { access } = issue(app, user.id);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, access) },
        payload: { name: 'а'.repeat(61) },
      });

      expect(res.statusCode).toBe(400);
    });

    it('слишком длинная должность отклоняется', async () => {
      const user = await createUser({ providerId: `patch-long-job-${suffix}` });
      const { access } = issue(app, user.id);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, access) },
        payload: { name: 'Имя', jobTitle: 'а'.repeat(101) },
      });

      expect(res.statusCode).toBe(400);
    });

    it('правка имени переживает следующий вход через OAuth — провайдер не должен её затирать', async () => {
      const providerId = `patch-survives-login-${suffix}`;
      const user = await createUser({ providerId });
      const { access } = issue(app, user.id);
      await app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: { cookie: cookieHeader(ACCESS_COOKIE, access) },
        payload: { name: 'Моё Имя', jobTitle: 'Тестировщик' },
      });

      // Повторный вход тем же провайдером — как будто пользователь перезалогинился
      const relogged = await new UsersRepository(db).upsertFromOAuth('google', {
        providerId,
        email: `user-${suffix}@example.com`,
        name: 'Имя От Провайдера',
        avatarUrl: 'https://example.com/new-avatar.png',
      });

      expect(relogged.id).toBe(user.id);
      expect(relogged.name).toBe('Моё Имя');
      expect(relogged.jobTitle).toBe('Тестировщик');
      expect(relogged.avatarUrl).toBe('https://example.com/new-avatar.png');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('выдаёт новую пару токенов по refresh-куке', async () => {
      const user = await createUser({ providerId: `refresh-${suffix}` });
      const { refresh } = await issueWithSession(app, db, user.id);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: cookieHeader(REFRESH_COOKIE, refresh) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ user: { id: user.id } });

      const access = res.cookies.find((c) => c.name === ACCESS_COOKIE);
      expect(access?.httpOnly).toBe(true);
      expect(access?.sameSite).toBe('Lax');
      expect(res.cookies.find((c) => c.name === REFRESH_COOKIE)?.path).toBe('/api/auth');
    });

    it('без куки отвечает 401', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/refresh' });

      expect(res.statusCode).toBe(401);
    });

    it('access-токен вместо refresh отклоняется', async () => {
      const user = await createUser({ providerId: `refresh-wrong-${suffix}` });
      const { access } = issue(app, user.id);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: cookieHeader(REFRESH_COOKIE, access) },
      });

      expect(res.statusCode).toBe(401);
    });

    it('без строки в sessions (например, после выхода на другом устройстве) отклоняется (7.6)', async () => {
      const user = await createUser({ providerId: `refresh-no-session-${suffix}` });
      const { refresh } = issue(app, user.id); // jti не заведён в sessions

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: cookieHeader(REFRESH_COOKIE, refresh) },
      });

      expect(res.statusCode).toBe(401);
    });

    it('повторное предъявление уже использованного refresh-токена отклоняется — обмен одноразовый (7.6)', async () => {
      const user = await createUser({ providerId: `refresh-rotate-${suffix}` });
      const { refresh } = await issueWithSession(app, db, user.id);

      const first = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: cookieHeader(REFRESH_COOKIE, refresh) },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: cookieHeader(REFRESH_COOKIE, refresh) },
      });
      expect(second.statusCode).toBe(401);
    });
  });

  it('POST /api/auth/logout гасит обе куки', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });

    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === ACCESS_COOKIE)?.value).toBe('');
    expect(res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value).toBe('');
  });

  it('POST /api/auth/logout отзывает сессию: тот же refresh-токен после выхода не работает (7.6)', async () => {
    const user = await createUser({ providerId: `logout-revokes-${suffix}` });
    const { refresh } = await issueWithSession(app, db, user.id);

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: cookieHeader(REFRESH_COOKIE, refresh) },
    });
    expect(logoutRes.statusCode).toBe(204);

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: cookieHeader(REFRESH_COOKIE, refresh) },
    });
    expect(refreshRes.statusCode).toBe(401);
  });

  it('GET /api/auth/providers перечисляет только настроенных провайдеров', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/providers' });

    expect(res.json()).toEqual({ providers: ['google'] });
  });

  it('GET /api/auth/google редиректит на провайдера с нужным redirect_uri', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/google' });

    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    );
    // PKCE включён — провайдеру уходит challenge, verifier остаётся в куке
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('GET /api/auth/yandex не заведён, пока нет ключей провайдера', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/yandex' });

    expect(res.statusCode).toBe(404);
  });

  describe('GET /api/auth/google/callback', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('заводит пользователя, ставит куки сессии и возвращает на фронт', async () => {
      const providerId = `callback-${suffix}`;
      const oauth = app.googleOauth2;
      if (!oauth) throw new Error('провайдер google не зарегистрирован');
      vi.spyOn(oauth, 'getAccessTokenFromAuthorizationCodeFlow').mockResolvedValue({
        token: { access_token: 'provider-token' },
      } as never);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            sub: providerId,
            email: `${providerId}@example.com`,
            email_verified: true,
            name: 'Из Колбэка',
            picture: 'https://example.com/a.png',
          }),
        })),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/google/callback?code=code-1&state=state-1',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/');
      expect(res.cookies.find((c) => c.name === ACCESS_COOKIE)?.value).toBeTruthy();
      expect(res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value).toBeTruthy();

      const [saved] = await db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.provider, 'google'), eq(schema.users.providerId, providerId)));
      expect(saved?.name).toBe('Из Колбэка');
      if (saved) createdUserIds.push(saved.id);
    });

    it('при невалидном state сессия не выдаётся', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/google/callback?code=code-1&state=подделка',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/login?error=oauth');
      expect(res.cookies.find((c) => c.name === ACCESS_COOKIE)).toBeUndefined();
    });

    it('отказ пользователя на экране провайдера не выдаёт сессию', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/google/callback?error=access_denied',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/login?error=oauth');
      expect(res.cookies.find((c) => c.name === ACCESS_COOKIE)).toBeUndefined();
    });
  });

  it('на https куки сессии уходят с флагом Secure', async () => {
    const secureApp = buildApp({ db, auth: { ...authConfig, cookieSecure: true } });
    await secureApp.ready();
    try {
      const user = await createUser({ providerId: `secure-${suffix}` });
      const { refresh } = await issueWithSession(secureApp, db, user.id);

      const res = await secureApp.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: cookieHeader(REFRESH_COOKIE, refresh) },
      });

      const access = res.cookies.find((c) => c.name === ACCESS_COOKIE);
      expect(access?.secure).toBe(true);
      expect(access?.path).toBe('/');
      expect(res.headers['cache-control']).toBe('no-store');
    } finally {
      await secureApp.close();
    }
  });

  describe('rate limit на /api/auth/* (7.8)', () => {
    // Свежий инстанс на каждый тест: у лимитера in-memory счётчик по IP+маршруту,
    // не хотим, чтобы эти тесты делили бюджет с остальными в файле
    const AUTH_RATE_LIMIT_MAX = 20; // должно совпадать с константой в src/auth/plugin.ts

    it('после превышения лимита конкретного маршрута отвечает 429 в общем формате ошибок', async () => {
      const limitedApp = buildApp({ db, auth: authConfig });
      await limitedApp.ready();
      try {
        let last: Awaited<ReturnType<typeof limitedApp.inject>> | undefined;
        for (let i = 0; i < AUTH_RATE_LIMIT_MAX + 1; i++) {
          last = await limitedApp.inject({ method: 'GET', url: '/api/auth/providers' });
        }
        expect(last?.statusCode).toBe(429);
        expect(last?.json()).toMatchObject({ error: 'too_many_requests' });
      } finally {
        await limitedApp.close();
      }
    });

    it('исчерпанный лимит одного маршрута не трогает бюджет другого', async () => {
      const limitedApp = buildApp({ db, auth: authConfig });
      await limitedApp.ready();
      try {
        for (let i = 0; i < AUTH_RATE_LIMIT_MAX + 1; i++) {
          await limitedApp.inject({ method: 'GET', url: '/api/auth/providers' });
        }

        const res = await limitedApp.inject({ method: 'POST', url: '/api/auth/logout' });

        expect(res.statusCode).toBe(204);
      } finally {
        await limitedApp.close();
      }
    });
  });
});
