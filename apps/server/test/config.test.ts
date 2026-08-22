/**
 * Флаг документации — единственное, что отделяет карту эндпоинтов от прода,
 * поэтому его разбор проверяется отдельно от роутов.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config';

function stubBaseEnv(): void {
  vi.stubEnv('DATABASE_URL', 'postgres://poker:poker@localhost:5432/poker');
  vi.stubEnv('JWT_SECRET', 'секрет-для-тестов-длиннее-тридцати-двух-символов');
  vi.stubEnv('GOOGLE_CLIENT_ID', '');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
  vi.stubEnv('YANDEX_CLIENT_ID', '');
  vi.stubEnv('YANDEX_CLIENT_SECRET', '');
  vi.stubEnv('MINIO_ACCESS_KEY', '');
  vi.stubEnv('MINIO_SECRET_KEY', '');
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

describe('loadConfig: объектное хранилище (21.1)', () => {
  it('без MINIO_ACCESS_KEY/MINIO_SECRET_KEY остаётся не задано', () => {
    stubBaseEnv();

    expect(loadConfig().objectStorage).toBeUndefined();
  });

  it('половина ключей MinIO считается ошибкой конфигурации', () => {
    stubBaseEnv();
    vi.stubEnv('MINIO_ACCESS_KEY', 'только-access');

    expect(() => loadConfig()).toThrow(/MINIO_ACCESS_KEY.*MINIO_SECRET_KEY/);
  });

  it('обе части собирают конфиг с дефолтами endpoint/port/bucket', () => {
    stubBaseEnv();
    vi.stubEnv('MINIO_ACCESS_KEY', 'app-access');
    vi.stubEnv('MINIO_SECRET_KEY', 'app-secret');

    expect(loadConfig().objectStorage).toEqual({
      endpoint: 'minio',
      port: 9000,
      useSSL: false,
      accessKey: 'app-access',
      secretKey: 'app-secret',
      bucket: 'poker-assets',
    });
  });

  it('MINIO_ENDPOINT/MINIO_PORT/MINIO_USE_SSL/MINIO_BUCKET переопределяют дефолты', () => {
    stubBaseEnv();
    vi.stubEnv('MINIO_ACCESS_KEY', 'app-access');
    vi.stubEnv('MINIO_SECRET_KEY', 'app-secret');
    vi.stubEnv('MINIO_ENDPOINT', 's3.example.com');
    vi.stubEnv('MINIO_PORT', '443');
    vi.stubEnv('MINIO_USE_SSL', 'true');
    vi.stubEnv('MINIO_BUCKET', 'custom-bucket');

    expect(loadConfig().objectStorage).toMatchObject({
      endpoint: 's3.example.com',
      port: 443,
      useSSL: true,
      bucket: 'custom-bucket',
    });
  });

  it('некорректный MINIO_PORT отклоняется', () => {
    stubBaseEnv();
    vi.stubEnv('MINIO_ACCESS_KEY', 'app-access');
    vi.stubEnv('MINIO_SECRET_KEY', 'app-secret');
    vi.stubEnv('MINIO_PORT', 'не число');

    expect(() => loadConfig()).toThrow(/MINIO_PORT/);
  });
});
