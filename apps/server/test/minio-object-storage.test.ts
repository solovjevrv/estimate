import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { MinioObjectStorage } from '../src/platform/storage';

/**
 * Интеграционный тест против настоящего MinIO — без него локально (без
 * MINIO_ACCESS_KEY/MINIO_SECRET_KEY) пропускается, как и БД-тесты без
 * DATABASE_URL (см. `rooms.test.ts`). В CI бакет и учётку поднимает
 * `minio-init` сервис (21.1).
 */
const accessKey = process.env.MINIO_ACCESS_KEY;
const secretKey = process.env.MINIO_SECRET_KEY;
const describeMinio = accessKey && secretKey ? describe : describe.skip;

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

describeMinio('MinioObjectStorage (интеграционный, реальный MinIO)', () => {
  const storage = new MinioObjectStorage({
    endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: accessKey as string,
    secretKey: secretKey as string,
    bucket: process.env.MINIO_BUCKET ?? 'estimate-assets',
  });
  const keys: string[] = [];

  afterAll(async () => {
    for (const key of keys) {
      await storage.remove(key).catch(() => {});
    }
  });

  function testKey(): string {
    const key = `test/${randomUUID()}.bin`;
    keys.push(key);
    return key;
  }

  it('ping не бросает — бакет существует и доступен', async () => {
    await expect(storage.ping()).resolves.toBeUndefined();
  });

  it('put затем get отдаёт тот же буфер', async () => {
    const key = testKey();
    const body = Buffer.from('hello minio');

    await storage.put(key, body, 'application/octet-stream');
    const stream = await storage.get(key);

    expect(stream).not.toBeNull();
    expect((await readAll(stream!)).equals(body)).toBe(true);
  });

  it('get отсутствующего ключа отдаёт null, не бросает', async () => {
    await expect(storage.get(`test/${randomUUID()}-missing.bin`)).resolves.toBeNull();
  });

  it('remove убирает объект — последующий get отдаёт null', async () => {
    const key = testKey();
    await storage.put(key, Buffer.from('x'), 'application/octet-stream');

    await storage.remove(key);

    await expect(storage.get(key)).resolves.toBeNull();
  });
});
