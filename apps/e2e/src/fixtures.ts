import { randomUUID } from 'node:crypto';

import fastifyJwt from '@fastify/jwt';
import { type Browser, type BrowserContext, test as base } from '@playwright/test';
import { ACCESS_COOKIE, TokenService, UsersRepository } from '@poker/server/auth/testkit';
import { createDb } from '@poker/server/db';
import type { AuthUser } from '@poker/shared';
import Fastify from 'fastify';

/** Домен-маркер: по нему глобальный teardown отличает e2e-пользователей от прочих данных БД */
export const E2E_EMAIL_DOMAIN = 'poker-e2e.test';
/** Префикс имени: у комнат нет отдельного маркера, поэтому чистим по имени */
export const E2E_ROOM_PREFIX = 'E2E ';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} не задан — нужен для запуска E2E (см. apps/e2e/README.md)`);
  }
  return value;
}

type Db = ReturnType<typeof createDb>['db'];

interface WorkerFixtures {
  db: Db;
  createUser: (label: string) => Promise<AuthUser>;
  loginAs: (context: BrowserContext, user: AuthUser) => Promise<void>;
}

interface TestFixtures {
  /**
   * `browser.newContext()` без параметров даёт англоязычный контекст по
   * умолчанию — приложение определяет язык по `navigator.languages`, а тексты
   * в тестах на русском. Через эту фабрику можно завести сколько угодно
   * независимых контекстов (владелец, гость и т.п.) в одном тесте.
   */
  newContext: (browser: Browser) => Promise<BrowserContext>;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // eslint-disable-next-line no-empty-pattern
  newContext: async ({}, use) => {
    const created: BrowserContext[] = [];
    await use(async (browser: Browser) => {
      const context = await browser.newContext({ locale: 'ru-RU' });
      created.push(context);
      return context;
    });
    await Promise.all(created.map((context) => context.close()));
  },

  db: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const { db, pool } = createDb(requireEnv('DATABASE_URL'));
      await use(db);
      await pool.end();
    },
    { scope: 'worker' },
  ],

  createUser: [
    async ({ db }, use) => {
      const users = new UsersRepository(db);
      await use(async (label: string) => {
        const id = randomUUID();
        return users.upsertFromOAuth('google', {
          providerId: `e2e-${label}-${id}`,
          email: `${label}-${id}@${E2E_EMAIL_DOMAIN}`,
          name: `E2E ${label}`,
          avatarUrl: null,
        });
      });
    },
    { scope: 'worker' },
  ],

  loginAs: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const app = Fastify();
      await app.register(fastifyJwt, { secret: requireEnv('JWT_SECRET') });
      await app.ready();
      const tokens = new TokenService(app.jwt, false);

      await use(async (context: BrowserContext, user: AuthUser) => {
        const { access } = tokens.issue(user.id, randomUUID());
        const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:5173';
        await context.addCookies([
          {
            name: ACCESS_COOKIE,
            value: access,
            url: webOrigin,
            httpOnly: true,
            secure: false,
          },
        ]);
      });

      await app.close();
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
