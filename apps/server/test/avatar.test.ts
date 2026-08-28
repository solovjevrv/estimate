/**
 * Загрузка аватарки (10.15) на реальной PostgreSQL: обработка/валидация файла,
 * защита от path traversal, отдельное хранилище override (не затирается повторным
 * входом через OAuth). Локально требует БД из docker-compose (корневой .env),
 * в CI — service-контейнер. Без DATABASE_URL — пропускается.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AuthUser } from '@estimate/shared';
import { AVATAR_MAX_BYTES } from '@estimate/shared';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, TokenService, UsersRepository } from '../src/auth';
import { AVATAR_KEY_PREFIX, avatarKey } from '../src/auth/avatar.service';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';
import { FakeObjectStorage } from '../src/platform/storage';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const PUBLIC_ORIGIN = 'http://localhost:3000';

const authConfig: AuthConfig = {
  jwtSecret: 'секрет-для-тестов-длиннее-тридцати-двух-символов',
  guestSecret: 'гостевой-секрет-для-тестов-длиннее-тридцати-двух',
  publicOrigin: PUBLIC_ORIGIN,
  webOrigin: 'http://localhost:5173',
  cookieSecure: false,
  providers: {},
};

/** Валидный маленький JPEG — генерируется на лету, без бинарных фикстур в репозитории */
async function testImage(color = { r: 200, g: 30, b: 30 }): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

function avatarForm(buffer: Buffer, filename: string, type: string): FormData {
  const form = new FormData();
  form.append('avatar', new File([buffer], filename, { type }));
  return form;
}

/** Сформировать валидное имя файла аватарки (32 hex + .webp) */
function randomAvatarFilename(): string {
  return `${randomBytes(16).toString('hex')}.webp`;
}

describeDb('загрузка аватарки', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let app: FastifyInstance;
  let storage: FakeObjectStorage;
  let avatarsDir: string;
  const userIds: string[] = [];

  function as(user: AuthUser): { cookie: string } {
    return {
      cookie: `${ACCESS_COOKIE}=${new TokenService(app.jwt, false).issue(user.id, randomUUID()).access}`,
    };
  }

  async function newUser(label: string): Promise<AuthUser> {
    const id = randomUUID();
    const user = await new UsersRepository(db).upsertFromOAuth('google', {
      providerId: `${label}-${id}`,
      email: `${label}-${id}@example.com`,
      name: `Пользователь ${label}`,
      avatarUrl: 'https://provider.example.com/avatar.png',
    });
    userIds.push(user.id);
    return user;
  }

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl as string));
    storage = new FakeObjectStorage();
    avatarsDir = mkdtempSync(join(tmpdir(), 'estimate-avatars-'));
    app = buildApp({ db, auth: authConfig, objectStorage: storage, avatarsDir });
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
      if (userIds.length > 0) {
        await db.delete(schema.users).where(inArray(schema.users.id, userIds));
      }
    } finally {
      await pool?.end();
      rmSync(avatarsDir, { recursive: true, force: true });
    }
  });

  it('успешная загрузка кладёт объект в storage, не на диск', async () => {
    const user = await newUser('upload');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: as(user),
      payload: avatarForm(await testImage(), 'photo.jpg', 'image/jpeg'),
    });

    expect(res.statusCode).toBe(200);
    const { user: updated } = res.json() as { user: AuthUser };
    expect(updated.avatarUrl).toMatch(/^\/api\/avatars\/[a-f0-9]{32}\.webp$/);

    const filename = updated.avatarUrl!.split('/').pop()!;
    expect(storage.peek(avatarKey(filename))).toBeDefined();
    expect(existsSync(join(avatarsDir, filename))).toBe(false);

    const served = await app.inject({ method: 'GET', url: `/api/avatars/${filename}` });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toContain('immutable');
  });

  it('отклоняет файл, который не является изображением, даже с валидным mime-заголовком', async () => {
    const user = await newUser('corrupt');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: as(user),
      payload: avatarForm(Buffer.from('это не картинка'), 'fake.jpg', 'image/jpeg'),
    });

    expect(res.statusCode).toBe(400);
  });

  it('отклоняет неподдерживаемый mime-тип до обработки sharp', async () => {
    const user = await newUser('badmime');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: as(user),
      payload: avatarForm(Buffer.from('plain text'), 'file.txt', 'text/plain'),
    });

    expect(res.statusCode).toBe(400);
  });

  it('отклоняет файл больше лимита', async () => {
    const user = await newUser('toolarge');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: as(user),
      payload: avatarForm(Buffer.alloc(AVATAR_MAX_BYTES + 1), 'huge.jpg', 'image/jpeg'),
    });

    expect(res.statusCode).toBe(413);
  });

  it('без входа — 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      payload: avatarForm(await testImage(), 'photo.jpg', 'image/jpeg'),
    });

    expect(res.statusCode).toBe(401);
  });

  it('при замене аватарки старый объект удаляется из storage', async () => {
    const user = await newUser('replace');

    const first = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: as(user),
      payload: avatarForm(await testImage({ r: 10, g: 200, b: 10 }), 'first.jpg', 'image/jpeg'),
    });
    const firstFilename = (first.json() as { user: AuthUser }).user.avatarUrl!.split('/').pop()!;
    expect(storage.peek(avatarKey(firstFilename))).toBeDefined();

    const second = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: as(user),
      payload: avatarForm(await testImage({ r: 10, g: 10, b: 200 }), 'second.jpg', 'image/jpeg'),
    });
    const secondFilename = (second.json() as { user: AuthUser }).user.avatarUrl!.split('/').pop()!;

    expect(secondFilename).not.toBe(firstFilename);
    expect(storage.peek(avatarKey(firstFilename))).toBeUndefined();
    expect(storage.peek(avatarKey(secondFilename))).toBeDefined();
  });

  it('повторный вход через OAuth не затирает загруженную аватарку', async () => {
    const usersRepository = new UsersRepository(db);
    const providerId = `relogin-${randomUUID()}`;
    const email = `relogin-${randomUUID()}@example.com`;
    const user = await usersRepository.upsertFromOAuth('google', {
      providerId,
      email,
      name: 'Пользователь relogin',
      avatarUrl: 'https://provider.example.com/avatar.png',
    });
    userIds.push(user.id);

    await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: as(user),
      payload: avatarForm(await testImage(), 'photo.jpg', 'image/jpeg'),
    });
    const afterUpload = await usersRepository.findById(user.id);
    expect(afterUpload?.avatarUrl).toContain('/api/avatars/');

    // Повторный вход — тот же provider+providerId (конфликт-таргет upsert), провайдер
    // снова присылает свою (другую) аватарку
    await usersRepository.upsertFromOAuth('google', {
      providerId,
      email,
      name: 'Пользователь relogin',
      avatarUrl: 'https://provider.example.com/new-avatar-from-relogin.png',
    });

    const afterRelogin = await usersRepository.findById(user.id);
    expect(afterRelogin?.avatarUrl).toBe(afterUpload?.avatarUrl);
  });

  it('отклоняет обращение к файлу вне формата случайного имени (защита от path traversal)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/avatars/..%2F..%2Fetc%2Fpasswd',
    });

    expect(res.statusCode).toBe(400);
  });

  it('несуществующий, но корректно оформленный файл — 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/avatars/${'a'.repeat(32)}.webp`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('файл, реально загруженный, отдаёт ровно один результат в storage', async () => {
    const user = await newUser('single-file');
    const before = storage.keys().filter((k) => k.startsWith(AVATAR_KEY_PREFIX)).length;

    await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: as(user),
      payload: avatarForm(await testImage(), 'photo.jpg', 'image/jpeg'),
    });

    expect(storage.keys().filter((k) => k.startsWith(AVATAR_KEY_PREFIX)).length).toBe(before + 1);
  });

  describe('переходное чтение legacy-каталога (fallback)', () => {
    it('GET /api/avatars/:filename отдаёт файл из storage, если он там есть', async () => {
      const buf = await sharp({
        create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } },
      })
        .webp()
        .toBuffer();
      const filename = randomAvatarFilename();
      await storage.put(avatarKey(filename), buf, 'image/webp');

      const res = await app.inject({ method: 'GET', url: `/api/avatars/${filename}` });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
    });

    it('GET /api/avatars/:filename отдаёт файл с диска, если его нет в storage (legacy, не мигрирован)', async () => {
      const filename = randomAvatarFilename();
      const buf = Buffer.from('legacy-content');
      writeFileSync(join(avatarsDir, filename), buf);

      const res = await app.inject({ method: 'GET', url: `/api/avatars/${filename}` });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body as string, 'binary');
      expect(body.toString('hex')).toBe(buf.toString('hex'));
    });

    it('GET /api/avatars/:filename — 404, если файла нет ни в storage, ни на диске', async () => {
      const filename = randomAvatarFilename();

      const res = await app.inject({ method: 'GET', url: `/api/avatars/${filename}` });

      expect(res.statusCode).toBe(404);
    });

    it('storage.get имеет приоритет над диском, если объект есть в обоих местах', async () => {
      const filename = randomAvatarFilename();
      const storageContent = Buffer.from('from-storage');
      const diskContent = Buffer.from('from-disk');
      await storage.put(avatarKey(filename), storageContent, 'image/webp');
      writeFileSync(join(avatarsDir, filename), diskContent);

      const res = await app.inject({ method: 'GET', url: `/api/avatars/${filename}` });

      expect(res.statusCode).toBe(200);
      const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body as string, 'binary');
      expect(body.toString('hex')).toBe(storageContent.toString('hex'));
    });
  });
});
