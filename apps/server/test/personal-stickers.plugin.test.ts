/**
 * Тесты роутов личных стикер-паков (21.6): публичный read-only доступ к метаданным
 * и файлам, 401 на auth-роуты без токена, rate limit на импорт.
 *
 * PersonalStickersService подменяется через vi.mock — тестируем роуты, а не БД.
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, TokenService } from '../src/auth';
import type { AuthConfig } from '../src/config';
import type { Db } from '../src/db';
import { FakeObjectStorage } from '../src/platform/storage';

// Подменяем сервис: роуты вызывают его методы, мы контролируем ответы
const mockService = vi.hoisted(() => ({
  getPublic: vi.fn(),
  findStickerLocation: vi.fn(),
  listOwn: vi.fn(),
  importFromTelegram: vi.fn(),
  deleteOwn: vi.fn(),
}));

vi.mock('../src/boards/personal-stickers.service', () => {
  const extensionByFormat: Record<string, string> = {
    static: 'webp',
    animated: 'json',
    video: 'webm',
  };
  class MockService {
    getPublic = mockService.getPublic;
    findStickerLocation = mockService.findStickerLocation;
    listOwn = mockService.listOwn;
    importFromTelegram = mockService.importFromTelegram;
    deleteOwn = mockService.deleteOwn;
  }
  return {
    PersonalStickersService: MockService,
    CONTENT_TYPE_BY_FORMAT: {
      static: 'image/webp',
      animated: 'application/json',
      video: 'video/webm',
    },
    personalStickerKey: (
      ownerId: string,
      packId: string,
      stickerId: string,
      format: string = 'static',
    ) => `stickers/users/${ownerId}/${packId}/${stickerId}.${extensionByFormat[format]}`,
  };
});

const authConfig: AuthConfig = {
  jwtSecret: 'секрет-для-тестов-длиннее-тридцати-двух-символов',
  guestSecret: 'гостевой-секрет-для-тестов-длиннее-тридцати-двух',
  publicOrigin: 'http://localhost:3000',
  webOrigin: 'http://localhost:5173',
  cookieSecure: false,
  providers: {},
};

function mockDb(): Db {
  return { execute: async () => [] } as unknown as Db;
}

function authCookie(app: FastifyInstance, userId = 'user-42'): string {
  const token = new TokenService(app.jwt, false).issue(userId, randomUUID()).access;
  return `${ACCESS_COOKIE}=${token}`;
}

describe('Personal stickers plugin — public routes', () => {
  let app: FastifyInstance;
  let storage: FakeObjectStorage;

  beforeAll(async () => {
    storage = new FakeObjectStorage();
    app = buildApp({
      db: mockDb(),
      auth: authConfig,
      objectStorage: storage,
      telegram: { botToken: 'test-bot-token' },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/sticker-packs/personal/:packId — 200 + метаданные пака', async () => {
    mockService.getPublic.mockResolvedValue({
      id: 'pack-uuid',
      title: 'Test Pack',
      telegramSetName: 'testpack',
      stickers: [{ id: 's1', emoji: '😀', format: 'static' }],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/sticker-packs/personal/${randomUUID()}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pack.title).toBe('Test Pack');
    expect(body.pack.telegramSetName).toBe('testpack');
    expect(body.pack.stickers).toEqual([{ id: 's1', emoji: '😀', format: 'static' }]);
  });

  it('GET /api/sticker-packs/personal/:packId — 404 если пак не найден', async () => {
    mockService.getPublic.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: `/api/sticker-packs/personal/${randomUUID()}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('GET /api/stickers/personal/:packId/:stickerId — 200 + content-type image/webp + cache-control immutable', async () => {
    const packId = randomUUID();
    const stickerId = 'aaaaaaaa-0000-0000-0000-000000000000';
    mockService.findStickerLocation.mockResolvedValue({
      ownerId: 'user-owner-id',
      format: 'static',
    });
    const buf = Buffer.from('sticker-bytes');
    await storage.put(
      `stickers/users/user-owner-id/${packId}/${stickerId}.webp`,
      buf,
      'image/webp',
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/stickers/personal/${packId}/${stickerId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('GET /api/stickers/personal/:packId/:stickerId — 200 + content-type video/webm для видео-стикера', async () => {
    const packId = randomUUID();
    const stickerId = 'bbbbbbbb-0000-0000-0000-000000000000';
    mockService.findStickerLocation.mockResolvedValue({
      ownerId: 'user-owner-id',
      format: 'video',
    });
    const buf = Buffer.from('video-bytes');
    await storage.put(
      `stickers/users/user-owner-id/${packId}/${stickerId}.webm`,
      buf,
      'video/webm',
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/stickers/personal/${packId}/${stickerId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/webm');
  });

  it('GET /api/stickers/personal/:packId/:stickerId — 404 если стикер не найден', async () => {
    mockService.findStickerLocation.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: `/api/stickers/personal/${randomUUID()}/${randomUUID()}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('работает без сессии (публичный доступ без аутентификации)', async () => {
    const packId = randomUUID();
    const stickerId = 'aaaaaaaa-0000-0000-0000-000000000000';
    mockService.findStickerLocation.mockResolvedValue({ ownerId: 'user-x', format: 'static' });
    const buf = Buffer.from('sticker-bytes');
    await storage.put(`stickers/users/user-x/${packId}/${stickerId}.webp`, buf, 'image/webp');

    const res = await app.inject({
      method: 'GET',
      url: `/api/stickers/personal/${packId}/${stickerId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
  });

  it('GET /api/sticker-packs/personal/:packId — 400 для невалидного UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sticker-packs/personal/invalid-uuid',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Personal stickers plugin — auth-protected routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      db: mockDb(),
      auth: authConfig,
      objectStorage: new FakeObjectStorage(),
      telegram: { botToken: 'test-bot-token' },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/sticker-packs/personal/import — 401 без токена', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sticker-packs/personal/import',
      body: { telegramSetName: 'testpack' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/sticker-packs/personal — 401 без токена', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sticker-packs/personal',
    });
    expect(res.statusCode).toBe(401);
  });

  it('DELETE /api/sticker-packs/personal/:packId — 401 без токена', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/sticker-packs/personal/${randomUUID()}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/sticker-packs/personal/import — 400 с пустым telegramSetName', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sticker-packs/personal/import',
      body: { telegramSetName: '' },
      headers: { cookie: authCookie(app, 'user-auth-1') },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/sticker-packs/personal/import — 400 при нарушении pattern', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sticker-packs/personal/import',
      body: { telegramSetName: '@bad_name!' },
      headers: { cookie: authCookie(app, 'user-auth-2') },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Personal stickers plugin — rate limiting (10/10 min)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      db: mockDb(),
      auth: authConfig,
      objectStorage: new FakeObjectStorage(),
      telegram: { botToken: 'test-bot-token' },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('11-й запрос импорта от того же пользователя — 429', async () => {
    const cookie = authCookie(app, 'user-ratelimit');

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sticker-packs/personal/import',
        body: { telegramSetName: 'x' },
        headers: { cookie },
      });
      expect(res.statusCode).not.toBe(429);
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/sticker-packs/personal/import',
      body: { telegramSetName: 'x' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(429);
  });

  it('лимит считается на пользователя, а не на IP (req.user должен быть заполнен до keyGenerator)', async () => {
    // Живой прогон нашёл: @fastify/rate-limit по умолчанию висит на onRequest,
    // раньше preHandler-аутентификации — req.user?.sub тогда всегда undefined,
    // и keyGenerator падал на req.ip, деля один бюджет на всех пользователей
    // с одного адреса. app.inject бьёт с одного "адреса" на все запросы —
    // если бы баг вернулся, второй пользователь получил бы 429 сразу же.
    const cookieA = authCookie(app, 'user-ratelimit-a');
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sticker-packs/personal/import',
        body: { telegramSetName: 'x' },
        headers: { cookie: cookieA },
      });
      expect(res.statusCode).not.toBe(429);
    }

    const cookieB = authCookie(app, 'user-ratelimit-b');
    const res = await app.inject({
      method: 'POST',
      url: '/api/sticker-packs/personal/import',
      body: { telegramSetName: 'x' },
      headers: { cookie: cookieB },
    });
    expect(res.statusCode).not.toBe(429);
  });
});
