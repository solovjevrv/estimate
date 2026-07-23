import fastifyJwt from '@fastify/jwt';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signSession, verifySessionToken } from '../src/auth';

const SECRET = 'секрет-для-тестов-длиннее-тридцати-двух-символов';

describe('токены сессии', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await app.register(fastifyJwt, { secret: SECRET });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('access-токен проверяется и отдаёт id пользователя', () => {
    const { access } = signSession(app.jwt, 'user-1');

    expect(verifySessionToken(app.jwt, access, 'access')).toBe('user-1');
  });

  it('access-токен не принимается вместо refresh (и наоборот)', () => {
    const { access, refresh } = signSession(app.jwt, 'user-1');

    expect(verifySessionToken(app.jwt, access, 'refresh')).toBeNull();
    expect(verifySessionToken(app.jwt, refresh, 'access')).toBeNull();
  });

  it('токен с чужой подписью отклоняется', async () => {
    const other = Fastify();
    await other.register(fastifyJwt, { secret: `${SECRET}-другой` });
    await other.ready();
    try {
      const { access } = signSession(other.jwt, 'user-1');

      expect(verifySessionToken(app.jwt, access, 'access')).toBeNull();
    } finally {
      await other.close();
    }
  });

  it('истёкший токен отклоняется', () => {
    const expired = app.jwt.sign({ sub: 'user-1', typ: 'access' }, { expiresIn: -1 });

    expect(verifySessionToken(app.jwt, expired, 'access')).toBeNull();
  });

  it('мусор вместо токена отклоняется без исключения', () => {
    expect(verifySessionToken(app.jwt, 'не-токен', 'access')).toBeNull();
  });
});
