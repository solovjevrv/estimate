/**
 * Тесты роутов Giphy (21.9): публичный доступ (без сессии), проксирование
 * поиска/трендов/медиа, rate limit на общую квоту ключа.
 *
 * GiphyService подменяется через vi.mock — тестируем роуты, а не саму Giphy.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import type { Db } from '../src/db';

const mockService = vi.hoisted(() => ({
  search: vi.fn(),
  trending: vi.fn(),
  resolveMediaUrl: vi.fn(),
}));

vi.mock('../src/boards/giphy.service', () => ({
  GiphyService: class {
    search = mockService.search;
    trending = mockService.trending;
    resolveMediaUrl = mockService.resolveMediaUrl;
  },
  GIPHY_MEDIA_VARIANTS: ['preview', 'full'],
  GIPHY_SEARCH_LIMIT_MAX: 50,
}));

function mockDb(): Db {
  return { execute: async () => [] } as unknown as Db;
}

const GIF_SUMMARY = {
  id: 'abc123',
  title: 'Funny cat',
  previewWidth: 100,
  previewHeight: 80,
  width: 480,
  height: 384,
};

describe('Giphy plugin', () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    app = buildApp({ db: mockDb(), giphy: { apiKey: 'test-key' } });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/giphy/search — 200 без сессии, проксирует запрос в сервис', async () => {
    mockService.search.mockResolvedValue([GIF_SUMMARY]);

    const res = await app.inject({ method: 'GET', url: '/api/giphy/search?q=cats' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ gifs: [GIF_SUMMARY] });
    expect(mockService.search).toHaveBeenCalledWith('cats', 24, 0);
  });

  it('GET /api/giphy/search — 400 без обязательного q', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/giphy/search' });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/giphy/search — подрезает limit до GIPHY_SEARCH_LIMIT_MAX', async () => {
    mockService.search.mockResolvedValue([]);
    await app.inject({ method: 'GET', url: '/api/giphy/search?q=cats&limit=9999&offset=10' });
    expect(mockService.search).toHaveBeenCalledWith('cats', 50, 10);
  });

  it('GET /api/giphy/trending — 200 без сессии', async () => {
    mockService.trending.mockResolvedValue([GIF_SUMMARY]);
    const res = await app.inject({ method: 'GET', url: '/api/giphy/trending' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ gifs: [GIF_SUMMARY] });
  });

  it('GET /api/giphy/media/:id/:variant — 200 + стримит байты + cache-control immutable', async () => {
    mockService.resolveMediaUrl.mockResolvedValue('https://media.giphy.com/abc123/original.gif');
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/gif' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('gif-bytes'));
          controller.close();
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.inject({ method: 'GET', url: '/api/giphy/media/abc123/full' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.body).toBe('gif-bytes');
    expect(mockService.resolveMediaUrl).toHaveBeenCalledWith('abc123', 'full');

    vi.unstubAllGlobals();
  });

  it('GET /api/giphy/media/:id/:variant — 404, если GIF не найден', async () => {
    mockService.resolveMediaUrl.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/giphy/media/missing/full' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/giphy/media/:id/:variant — 400 на недопустимый variant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/giphy/media/abc123/huge' });
    expect(res.statusCode).toBe(400);
  });
});

describe('Giphy plugin — не регистрируется без ключа', () => {
  it('без giphy в конфиге роут отдаёт 404 (не зарегистрирован)', async () => {
    const app = buildApp({ db: mockDb() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/giphy/trending' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('Giphy plugin — rate limit на общую квоту (не per-user)', () => {
  it('601-й запрос за минуту — 429', async () => {
    const app = buildApp({ db: mockDb(), giphy: { apiKey: 'test-key' } });
    await app.ready();
    mockService.trending.mockResolvedValue([]);

    for (let i = 0; i < 600; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/giphy/trending' });
      expect(res.statusCode).not.toBe(429);
    }
    const res = await app.inject({ method: 'GET', url: '/api/giphy/trending' });
    expect(res.statusCode).toBe(429);

    await app.close();
  });
});
