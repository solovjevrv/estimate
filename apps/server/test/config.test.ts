/**
 * Флаг документации — единственное, что отделяет карту эндпоинтов от прода,
 * поэтому его разбор проверяется отдельно от роутов.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config';

function stubBaseEnv(): void {
  vi.stubEnv('DATABASE_URL', 'postgres://estimate:estimate@localhost:5432/estimate');
  vi.stubEnv('JWT_SECRET', 'секрет-для-тестов-длиннее-тридцати-двух-символов');
  vi.stubEnv('GOOGLE_CLIENT_ID', '');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
  vi.stubEnv('YANDEX_CLIENT_ID', '');
  vi.stubEnv('YANDEX_CLIENT_SECRET', '');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadConfig: документация', () => {
  it('на продакшене выключена', () => {
    stubBaseEnv();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DOCS_ENABLED', '');

    expect(loadConfig().docsEnabled).toBe(false);
  });

  it('вне продакшена включена', () => {
    stubBaseEnv();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DOCS_ENABLED', '');

    expect(loadConfig().docsEnabled).toBe(true);
  });

  it('DOCS_ENABLED=true включает документацию даже на проде', () => {
    stubBaseEnv();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DOCS_ENABLED', 'true');

    expect(loadConfig().docsEnabled).toBe(true);
  });

  it('любое другое значение DOCS_ENABLED выключает документацию', () => {
    stubBaseEnv();
    vi.stubEnv('NODE_ENV', 'development');

    for (const value of ['false', '1', 'yes', 'да']) {
      vi.stubEnv('DOCS_ENABLED', value);
      expect(loadConfig().docsEnabled, `значение "${value}"`).toBe(false);
    }
  });
});

describe('loadConfig: обязательные переменные', () => {
  it('без JWT_SECRET конфиг не собирается', () => {
    stubBaseEnv();
    vi.stubEnv('JWT_SECRET', '');

    expect(() => loadConfig()).toThrow(/JWT_SECRET/);
  });

  it('короткий JWT_SECRET отклоняется', () => {
    stubBaseEnv();
    vi.stubEnv('JWT_SECRET', 'коротко');

    expect(() => loadConfig()).toThrow(/JWT_SECRET/);
  });

  it('половина ключей провайдера считается ошибкой конфигурации', () => {
    stubBaseEnv();
    vi.stubEnv('GOOGLE_CLIENT_ID', 'только-id');

    expect(() => loadConfig()).toThrow(/google/);
  });
});
