import { randomUUID } from 'node:crypto';

import fastifyJwt from '@fastify/jwt';
import { ACCESS_COOKIE, TokenService } from '@estimate/server/auth/testkit';
import Fastify from 'fastify';

/**
 * Минтит валидный access-JWT в обход настоящего OAuth-флоу — тот же приём,
 * что и в apps/e2e/src/fixtures.ts. Access-токен полностью stateless (не
 * привязан к строке в `sessions`), поэтому `refreshJti` в issue() ни на что
 * не влияет и может быть случайным.
 */
export async function createAuthMinter(
  jwtSecret: string,
): Promise<{ mint: (userId: string) => string; close: () => Promise<void> }> {
  const app = Fastify();
  await app.register(fastifyJwt, { secret: jwtSecret });
  await app.ready();
  const tokens = new TokenService(app.jwt, false);

  return {
    mint(userId: string): string {
      const { access } = tokens.issue(userId, randomUUID());
      return `${ACCESS_COOKIE}=${access}`;
    },
    close: () => app.close(),
  };
}
