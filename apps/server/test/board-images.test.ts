/**
 * Загрузка/отдача картинок досок (13.2) на реальной PostgreSQL: multipart-загрузка,
 * матрица прав (edit — на загрузку, view/членство — на отдачу), защита от чужой
 * доски/path traversal, очистка файла при удалении элемента/доски. Без
 * DATABASE_URL — пропускается.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOARD_IMAGE_MAX_BYTES, boardImageUrl, type AuthUser } from '@poker/shared';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, TokenService, UsersRepository } from '../src/auth';
import { BoardImagesService, BoardsService } from '../src/boards';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';
import { FakeObjectStorage } from '../src/platform/storage';
import { TeamsRepository, TeamsService } from '../src/teams';
import { boardImageKey } from '../src/boards/board-images.service';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const authConfig: AuthConfig = {
  jwtSecret: 'секрет-для-тестов-длиннее-тридцати-двух-символов',
  guestSecret: 'гостевой-секрет-для-тестов-длиннее-тридцати-двух',
  publicOrigin: 'http://localhost:3000',
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

function imageForm(buffer: Buffer, filename: string, type: string): FormData {
  const form = new FormData();
  form.append('file', new File([buffer], filename, { type }));
  return form;
}

describeDb('картинки досок', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let app: FastifyInstance;
  let storage: FakeObjectStorage;
  let assetsDir: string;
  let avatarsDir: string;
  let teamsService: TeamsService;
  let teamsRepository: TeamsRepository;
  const userIds: string[] = [];
  const teamIds: string[] = [];
  const boardIds: string[] = [];

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
      avatarUrl: null,
    });
    userIds.push(user.id);
    return user;
  }

  async function newTeam(
    creator: AuthUser,
    members: Array<[AuthUser, 'admin' | 'member' | 'guest']> = [],
  ): Promise<string> {
    const team = await teamsService.create(creator.id, `Команда ${randomUUID().slice(0, 8)}`);
    teamIds.push(team.id);
    for (const [user, role] of members) {
      await teamsRepository.insertMemberIfAbsent(team.id, user.id, role);
    }
    return team.id;
  }

  async function newBoard(actor: AuthUser, teamId?: string | null): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: as(actor),
      payload: { title: `Доска ${randomUUID().slice(0, 8)}`, teamId: teamId ?? null },
    });
    const id = (res.json() as { board: { id: string } }).board.id;
    boardIds.push(id);
    return id;
  }

  async function upload(
    boardId: string,
    actor: AuthUser,
    payload: FormData,
  ): Promise<{ statusCode: number; url?: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/assets`,
      headers: as(actor),
      payload,
    });
    return { statusCode: res.statusCode, url: (res.json() as { url?: string }).url };
  }

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl as string));
    teamsRepository = new TeamsRepository(db);
    teamsService = new TeamsService(db, teamsRepository);
    storage = new FakeObjectStorage();
    assetsDir = mkdtempSync(join(tmpdir(), 'poker-board-assets-'));
    // Оба каталога, как в проде (app.ts регистрирует avatarPlugin и
    // boardImagesPlugin вместе) — так тест ловит коллизии между их
    // независимыми регистрациями @fastify/multipart
    avatarsDir = mkdtempSync(join(tmpdir(), 'poker-avatars-'));
    app = buildApp({
      db,
      auth: authConfig,
      boardAssetsDir: assetsDir,
      avatarsDir,
      objectStorage: storage,
    });
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
      if (boardIds.length > 0) {
        await db.delete(schema.boards).where(inArray(schema.boards.id, boardIds));
      }
      if (teamIds.length > 0) {
        await db.delete(schema.teams).where(inArray(schema.teams.id, teamIds));
      }
      if (userIds.length > 0) {
        await db.delete(schema.users).where(inArray(schema.users.id, userIds));
      }
    } finally {
      await pool?.end();
      rmSync(assetsDir, { recursive: true, force: true });
      rmSync(avatarsDir, { recursive: true, force: true });
    }
  });

  describe('POST /api/boards/:id/assets', () => {
    it('владелец личной доски загружает картинку — она пережимается в webp и лежит на диске', async () => {
      const owner = await newUser('upload-owner');
      const boardId = await newBoard(owner);

      const res = await upload(
        boardId,
        owner,
        imageForm(await testImage(), 'photo.jpg', 'image/jpeg'),
      );

      expect(res.statusCode).toBe(200);
      expect(res.url).toMatch(new RegExp(`^/api/boards/${boardId}/assets/[a-f0-9]{32}\\.webp$`));
      const filename = res.url!.split('/').pop()!;
      expect(storage.peek(boardImageKey(boardId, filename))).toBeDefined();
    });

    it('участник и администратор команды могут загрузить, гость — нет', async () => {
      const admin = await newUser('upload-admin');
      const member = await newUser('upload-member');
      const guest = await newUser('upload-guest');
      const teamId = await newTeam(admin, [
        [member, 'member'],
        [guest, 'guest'],
      ]);
      const boardId = await newBoard(admin, teamId);

      const byMember = await upload(
        boardId,
        member,
        imageForm(await testImage(), 'a.jpg', 'image/jpeg'),
      );
      const byGuest = await upload(
        boardId,
        guest,
        imageForm(await testImage(), 'b.jpg', 'image/jpeg'),
      );

      expect(byMember.statusCode).toBe(200);
      expect(byGuest.statusCode).toBe(403);
    });

    it('чужая (или несуществующая) доска отвечает 404, а не 403 — id не перебрать', async () => {
      const stranger = await newUser('upload-stranger');

      const res = await upload(
        randomUUID(),
        stranger,
        imageForm(await testImage(), 'c.jpg', 'image/jpeg'),
      );

      expect(res.statusCode).toBe(404);
    });

    it('без входа на закрытую доску — 404 (анти-перебор)', async () => {
      const owner = await newUser('upload-noauth-owner');
      const boardId = await newBoard(owner);

      const res = await app.inject({
        method: 'POST',
        url: `/api/boards/${boardId}/assets`,
        payload: imageForm(await testImage(), 'd.jpg', 'image/jpeg'),
      });

      expect(res.statusCode).toBe(404);
    });

    it('отклоняет неподдерживаемый mime-тип до обработки sharp', async () => {
      const owner = await newUser('upload-badmime-owner');
      const boardId = await newBoard(owner);

      const res = await upload(
        boardId,
        owner,
        imageForm(Buffer.from('plain text'), 'f.txt', 'text/plain'),
      );

      expect(res.statusCode).toBe(400);
    });

    it('отклоняет файл, который не является изображением, даже с валидным mime-заголовком', async () => {
      const owner = await newUser('upload-corrupt-owner');
      const boardId = await newBoard(owner);

      const res = await upload(
        boardId,
        owner,
        imageForm(Buffer.from('это не картинка'), 'fake.jpg', 'image/jpeg'),
      );

      expect(res.statusCode).toBe(400);
    });

    it('отклоняет файл больше лимита', async () => {
      const owner = await newUser('upload-toolarge-owner');
      const boardId = await newBoard(owner);

      const res = await upload(
        boardId,
        owner,
        imageForm(Buffer.alloc(BOARD_IMAGE_MAX_BYTES + 1), 'huge.jpg', 'image/jpeg'),
      );

      expect(res.statusCode).toBe(413);
    });
  });

  describe('GET /api/boards/:id/assets/:filename', () => {
    it('отдаёт картинку любому участнику доски, включая гостя', async () => {
      const admin = await newUser('serve-admin');
      const guest = await newUser('serve-guest');
      const teamId = await newTeam(admin, [[guest, 'guest']]);
      const boardId = await newBoard(admin, teamId);
      const { url } = await upload(
        boardId,
        admin,
        imageForm(await testImage(), 'g.jpg', 'image/jpeg'),
      );

      const res = await app.inject({ method: 'GET', url: url!, headers: as(guest) });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['cache-control']).toContain('immutable');
    });

    it('не отдаёт картинку не-участнику команды — 404', async () => {
      const admin = await newUser('serve-priv-admin');
      const stranger = await newUser('serve-priv-stranger');
      const teamId = await newTeam(admin);
      const boardId = await newBoard(admin, teamId);
      const { url } = await upload(
        boardId,
        admin,
        imageForm(await testImage(), 'h.jpg', 'image/jpeg'),
      );

      const res = await app.inject({ method: 'GET', url: url!, headers: as(stranger) });

      expect(res.statusCode).toBe(404);
    });

    it('несуществующий (но валидный по формату) файл — 404', async () => {
      const owner = await newUser('serve-missing-owner');
      const boardId = await newBoard(owner);

      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${boardId}/assets/${'a'.repeat(32)}.webp`,
        headers: as(owner),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // applyOps/remove ходят по WS в проде, но сам метод — обычный сервисный код;
  // дёргаем BoardsService напрямую, чтобы не поднимать сокеты только ради этого
  function boardsService(): BoardsService {
    const images = BoardImagesService.create(storage, assetsDir);
    return BoardsService.forDatabase(db, authConfig.guestSecret, images);
  }

  function imageItem(id: string, url: string): Parameters<BoardsService['applyOps']>[2][number] {
    return {
      type: 'item.create',
      clientOpId: randomUUID(),
      item: {
        id,
        parentId: null,
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        rotation: 0,
        zIndex: 0,
        content: { type: 'image', url, width: 40, height: 40 },
        style: { color: '#FCEB96' },
        reactions: [],
      },
    };
  }

  describe('очистка файлов в storage (BoardsService.applyOps/remove, минуя транспорт WS)', () => {
    it('удаление элемента-картинки чистит файл в storage', async () => {
      const owner = await newUser('cleanup-delete-owner');
      const boardId = await newBoard(owner);
      const { url } = await upload(
        boardId,
        owner,
        imageForm(await testImage(), 'i.jpg', 'image/jpeg'),
      );
      const filename = url!.split('/').pop()!;
      expect(storage.peek(boardImageKey(boardId, filename))).toBeDefined();

      const service = boardsService();
      const itemId = randomUUID();
      await service.applyOps(
        { participantId: owner.id, userId: owner.id, name: owner.name },
        boardId,
        [imageItem(itemId, url!)],
      );
      await service.applyOps(
        { participantId: owner.id, userId: owner.id, name: owner.name },
        boardId,
        [{ type: 'item.delete', clientOpId: randomUUID(), id: itemId }],
      );

      expect(storage.peek(boardImageKey(boardId, filename))).toBeUndefined();
    });

    it('замена картинки другим содержимым (patch content) чистит старый файл', async () => {
      const owner = await newUser('cleanup-patch-owner');
      const boardId = await newBoard(owner);
      const { url } = await upload(
        boardId,
        owner,
        imageForm(await testImage(), 'j.jpg', 'image/jpeg'),
      );
      const filename = url!.split('/').pop()!;

      const service = boardsService();
      const itemId = randomUUID();
      await service.applyOps(
        { participantId: owner.id, userId: owner.id, name: owner.name },
        boardId,
        [imageItem(itemId, url!)],
      );
      await service.applyOps(
        { participantId: owner.id, userId: owner.id, name: owner.name },
        boardId,
        [
          {
            type: 'item.patch',
            clientOpId: randomUUID(),
            id: itemId,
            patch: { content: { type: 'sticky', text: 'Уже не картинка' } },
          },
        ],
      );

      expect(storage.peek(boardImageKey(boardId, filename))).toBeUndefined();
    });

    it('удаление доски чистит файлы всех её картинок', async () => {
      const owner = await newUser('cleanup-board-owner');
      const boardId = await newBoard(owner);
      const { url } = await upload(
        boardId,
        owner,
        imageForm(await testImage(), 'k.jpg', 'image/jpeg'),
      );
      const filename = url!.split('/').pop()!;

      const service = boardsService();
      await service.applyOps(
        { participantId: owner.id, userId: owner.id, name: owner.name },
        boardId,
        [imageItem(randomUUID(), url!)],
      );
      await app.inject({
        method: 'POST',
        url: `/api/boards/${boardId}/archive`,
        headers: as(owner),
      });
      await service.remove(owner.id, boardId);

      expect(storage.peek(boardImageKey(boardId, filename))).toBeUndefined();
    });
  });

  describe('переходное чтение legacy-каталога (fallback) и защита от межбордовой утечки', () => {
    /** Случайное валидное имя файла картинки доски (32 hex + .webp) */
    function randomFilename(): string {
      return `${randomBytes(16).toString('hex')}.webp`;
    }

    it('GET .../assets/:filename отдаёт файл из storage, если он там есть', async () => {
      const owner = await newUser('legacy-storage-owner');
      const boardId = await newBoard(owner);
      const { url } = await upload(
        boardId,
        owner,
        imageForm(await testImage(), 'l1.jpg', 'image/jpeg'),
      );
      const filename = url!.split('/').pop()!;

      const res = await app.inject({
        method: 'GET',
        url,
        headers: as(owner),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      // Файл уже в storage — disk fallback не используется
      expect(storage.peek(boardImageKey(boardId, filename))).toBeDefined();
    });

    it('GET .../assets/:filename отдаёт файл с диска, если он в БД привязан к этой доске (legacy, не мигрирован)', async () => {
      const owner = await newUser('legacy-disk-owner');
      const boardId = await newBoard(owner);
      const filename = randomFilename();
      const buf = Buffer.from('legacy-board-image-content');
      // upload всегда пишет в storage, поэтому эмулируем legacy-файл вручную
      writeFileSync(join(assetsDir, filename), buf);

      const service = boardsService();
      const itemId = randomUUID();
      await service.applyOps(
        { participantId: owner.id, userId: owner.id, name: owner.name },
        boardId,
        [imageItem(itemId, boardImageUrl(boardId, filename))],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${boardId}/assets/${filename}`,
        headers: as(owner),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body as string, 'binary');
      expect(body.toString('hex')).toBe(buf.toString('hex'));
    });

    it('GET .../assets/:filename — 404, если файл на диске есть, но ни один item этой доски на него не ссылается (межбордовая утечка закрыта)', async () => {
      const owner = await newUser('leak-orphan-owner');
      const boardId = await newBoard(owner);
      const filename = randomFilename();
      const buf = Buffer.from('orphaned-legacy-content');
      writeFileSync(join(assetsDir, filename), buf);

      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${boardId}/assets/${filename}`,
        headers: as(owner),
      });

      expect(res.statusCode).toBe(404);
    });

    it('GET .../assets/:filename — 404, если filename привязан к ДРУГОЙ доске, не к запрошенной', async () => {
      const owner = await newUser('leak-cross-owner');
      const boardA = await newBoard(owner);
      const boardB = await newBoard(owner);
      const filename = randomFilename();
      const buf = Buffer.from('board-a-legacy-content');
      writeFileSync(join(assetsDir, filename), buf);

      // Файл привязан ТОЛЬКО к boardA через БД
      const service = boardsService();
      await service.applyOps(
        { participantId: owner.id, userId: owner.id, name: owner.name },
        boardA,
        [imageItem(randomUUID(), boardImageUrl(boardA, filename))],
      );

      // owner имеет полный доступ к boardB, но файл принадлежит boardA — 404
      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${boardB}/assets/${filename}`,
        headers: as(owner),
      });

      expect(res.statusCode).toBe(404);
    });

    it('storage.get имеет приоритет над легаси-диском, если объект есть в обоих местах', async () => {
      const owner = await newUser('legacy-priority-owner');
      const boardId = await newBoard(owner);
      const filename = randomFilename();
      const storageContent = Buffer.from('from-storage');
      const diskContent = Buffer.from('from-disk');
      await storage.put(boardImageKey(boardId, filename), storageContent, 'image/webp');
      writeFileSync(join(assetsDir, filename), diskContent);

      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${boardId}/assets/${filename}`,
        headers: as(owner),
      });

      expect(res.statusCode).toBe(200);
      const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body as string, 'binary');
      expect(body.toString('hex')).toBe(storageContent.toString('hex'));
    });
  });
});
