import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TokenService } from '../src/auth';

const SECRET = 'секрет-для-тестов-длиннее-тридцати-двух-символов';

async function jwtApp(secret: string): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(fastifyJwt, { secret });
  await app.ready();
  return app;
}

describe('TokenService', () => {
  let app: FastifyInstance;
  let tokens: TokenService;

  beforeAll(async () => {
    app = await jwtApp(SECRET);
    tokens = new TokenService(app.jwt, false);
  });

  afterAll(async () => {
    await app.close();
  });

  it('access-токен проверяется и отдаёт id пользователя', () => {
    const { access } = tokens.issue('user-1', 'session-1');

    expect(tokens.verify(access, 'access')).toBe('user-1');
  });

  it('access-токен не принимается вместо refresh (и наоборот)', () => {
    const { access, refresh } = tokens.issue('user-1', 'session-1');

    expect(tokens.verify(access, 'refresh')).toBeNull();
    expect(tokens.verify(refresh, 'access')).toBeNull();
  });

  it('токен с чужой подписью отклоняется', async () => {
    const other = await jwtApp(`${SECRET}-другой`);
    try {
      const { access } = new TokenService(other.jwt, false).issue('user-1', 'session-1');

      expect(tokens.verify(access, 'access')).toBeNull();
    } finally {
      await other.close();
    }
  });

  it('истёкший токен отклоняется', () => {
    const expired = app.jwt.sign({ sub: 'user-1', typ: 'access' }, { expiresIn: -1 });

    expect(tokens.verify(expired, 'access')).toBeNull();
  });

  it('мусор вместо токена отклоняется без исключения', () => {
    expect(tokens.verify('не-токен', 'access')).toBeNull();
  });

  it('читает пользователя из заголовка Cookie и не верит подделке', () => {
    const { access } = tokens.issue('user-7', 'session-7');

    expect(tokens.readUserIdFromCookieHeader(`pp_access=${access}`)).toBe('user-7');
    expect(tokens.readUserIdFromCookieHeader('pp_access=forged.jwt.value')).toBeNull();
    expect(tokens.readUserIdFromCookieHeader(undefined)).toBeNull();
  });

  describe('verifyRefresh (7.6)', () => {
    it('достаёт id пользователя и jti из refresh-токена', () => {
      const { refresh } = tokens.issue('user-1', 'session-abc');

      expect(tokens.verifyRefresh(refresh)).toEqual({ userId: 'user-1', jti: 'session-abc' });
    });

    it('access-токен не проходит вместо refresh', () => {
      const { access } = tokens.issue('user-1', 'session-abc');

      expect(tokens.verifyRefresh(access)).toBeNull();
    });

    it('refresh-токен без jti (старый формат/подделка) отклоняется', () => {
      const legacy = app.jwt.sign({ sub: 'user-1', typ: 'refresh' });

      expect(tokens.verifyRefresh(legacy)).toBeNull();
    });

    it('мусор вместо токена отклоняется без исключения', () => {
      expect(tokens.verifyRefresh('не-токен')).toBeNull();
    });
  });
});
