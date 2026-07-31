import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import type { Db } from '../src/db';

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
