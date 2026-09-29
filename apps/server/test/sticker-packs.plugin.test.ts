/**
 * Тесты публичного read-only эндпоинта стикеров /api/stickers/:version/:pack/:filename (21.3):
 * отдача с immutable-кэшем и content-type image/webp, 404 при отсутствии объекта,
 * защита от path traversal через схему параметров, работа без сессии/аутентификации.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import type { AuthConfig } from '../src/config';
import type { Db } from '../src/db';
import { FakeObjectStorage } from '../src/platform/storage';

const authConfig: AuthConfig = {
  jwtSecret: 'секрет-для-тестов-длиннее-тридцати-двух-символов',
  guestSecret: 'гостевой-секрет-для-тестов-длиннее-тридцати-двух',
  publicOrigin: 'http://localhost:3000',
  webOrigin: 'http://localhost:5173',
  cookieSecure: false,
  providers: {},
};

function mockDb(): Db {
  return { execute: vi.fn(async () => []) } as unknown as Db;
}

describe('GET /api/stickers/:version/:pack/:filename', () => {
  let app: FastifyInstance;
  let storage: FakeObjectStorage;

  beforeAll(async () => {
    storage = new FakeObjectStorage();
    // Стороны плагина зарегистрированы внутри if (deps.auth) && if (deps.objectStorage)
    // в app.ts — передаём оба, чтобы маршрут стикеров был активен.
    app = buildApp({ db: mockDb(), auth: authConfig, objectStorage: storage });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('отдаёт файл с cache-control immutable и content-type image/webp', async () => {
    const buf = Buffer.from('sticker-bytes');
    await storage.put('stickers/v1/dev-pack/01.webp', buf, 'image/webp');

    const res = await app.inject({
      method: 'GET',
      url: '/api/stickers/v1/dev-pack/01.webp',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toContain('immutable');
    const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body as string, 'binary');
    expect(body.toString('hex')).toBe(buf.toString('hex'));
  });

  it('404, если объекта нет в storage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/stickers/v1/dev-pack/99.webp',
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 (не 500) на путь с недопустимыми символами в pack/filename', async () => {
    // ../../etc/passwd — URL-парсер нормализует .., маршрут не совпадает → 404.
    // Главное: storage.get не вызывается, статус ≠ 500.
    const getSpy = vi.spyOn(storage, 'get');

    const res = await app.inject({
      method: 'GET',
      url: '/api/stickers/v1/../../etc/passwd',
    });

    expect(res.statusCode).toBe(404);
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it('работает без сессии/аутентификации', async () => {
    const buf = Buffer.from('public-sticker');
    await storage.put('stickers/v1/dev-pack/02.webp', buf, 'image/webp');

    const res = await app.inject({
      method: 'GET',
      url: '/api/stickers/v1/dev-pack/02.webp',
    });

    expect(res.statusCode).toBe(200);
  });
});
