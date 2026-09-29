import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import type { Db } from '../src/db';
import { FakeObjectStorage } from '../src/platform/storage';

function mockDb(executeImpl: () => Promise<unknown>): Db {
  return { execute: vi.fn(executeImpl) } as unknown as Db;
}

describe('GET /health', () => {
  it('отвечает 200 со статусом ok при доступной БД', async () => {
    const app = buildApp({ db: mockDb(async () => []) });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('отвечает 503 при недоступной БД', async () => {
    const app = buildApp({
      db: mockDb(async () => {
        throw new Error('connection refused');
      }),
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: 'degraded', db: 'down' });
    } finally {
      await app.close();
    }
  });

  it('закрывает ресурсы БД при остановке приложения', async () => {
    const closeDb = vi.fn(async () => {});
    const app = buildApp({ db: mockDb(async () => []), closeDb });

    await app.close();

    expect(closeDb).toHaveBeenCalledOnce();
  });

  it('не проверяет хранилище, если оно не подключено (Epic 21 до миграции — опционально)', async () => {
    const app = buildApp({ db: mockDb(async () => []) });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('storage');
    } finally {
      await app.close();
    }
  });

  it('отвечает 200 со статусом storage:ok, если хранилище подключено и доступно', async () => {
    const app = buildApp({ db: mockDb(async () => []), objectStorage: new FakeObjectStorage() });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok', db: 'ok', storage: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('отвечает 503, если хранилище подключено, но недоступно', async () => {
    const storage = new FakeObjectStorage();
    storage.available = false;
    const app = buildApp({ db: mockDb(async () => []), objectStorage: storage });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: 'degraded', db: 'ok', storage: 'down' });
    } finally {
      await app.close();
    }
  });
});

describe('security-заголовки — 6.2', () => {
  it('ответ несёт базовую защиту от clickjacking и MIME-sniffing', async () => {
    const app = buildApp({ db: mockDb(async () => []) });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    } finally {
      await app.close();
    }
  });
});
