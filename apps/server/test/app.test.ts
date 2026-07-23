import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';

describe('GET /health', () => {
  it('отвечает 200 со статусом ok', async () => {
    const app = buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});
