/**
 * Тесты миграции картинок досок с диска в ObjectStorage (21.5): идемпотентность,
 * сверка по SHA-256, защита от перезаписи при расхождении, dry-run, filter
 * по имени файла, сохранение исходников, orphan-файлы без ссылки в БД,
 * разные boardId в ключе.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boardImageUrl, type AuthUser } from '@estimate/shared';
import { inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardsService } from '../src/boards';
import { UsersRepository } from '../src/auth';
import { boardImageKey } from '../src/boards/board-images.service';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';
import { FakeObjectStorage } from '../src/platform/storage';
import { buildFilenameToBoardId, migrateBoardImages } from '../src/scripts/migrate-board-images';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Сформировать валидное имя файла картинки доски (32 hex + .webp) */
function randomFilename(): string {
  return `${randomBytes(16).toString('hex')}.webp`;
}

describe('migrateBoardImages', () => {
  let legacyDir: string;
  let storage: FakeObjectStorage;

  beforeEach(() => {
    legacyDir = mkdtempSync(join(tmpdir(), 'estimate-migrate-board-images-'));
    storage = new FakeObjectStorage();
  });

  afterEach(() => {
    rmSync(legacyDir, { recursive: true, force: true });
  });

  it('переносит новый файл с диска в storage с boardId-scoped ключом и хеш совпадает', async () => {
    const filename = randomFilename();
    const boardId = randomUUID();
    const buf = Buffer.from('board-image-content');
    writeFileSync(join(legacyDir, filename), buf);

    const report = await migrateBoardImages({
      legacyDir,
      storage,
      filenameToBoardId: new Map([[filename, boardId]]),
      dryRun: false,
    });

    expect(report.scanned).toBe(1);
    expect(report.migrated).toBe(1);
    expect(report.alreadyInSync).toBe(0);
    expect(report.orphaned).toHaveLength(0);
    expect(report.mismatches).toHaveLength(0);
    expect(report.errors).toHaveLength(0);

    const stored = storage.peek(boardImageKey(boardId, filename));
    expect(stored).toBeDefined();
    expect(sha256(stored!.body)).toBe(sha256(buf));
  });

  it('идемпотентна: повторный запуск не переписывает уже совпадающий объект', async () => {
    const filename = randomFilename();
    const boardId = randomUUID();
    const buf = Buffer.from('board-image-content');
    writeFileSync(join(legacyDir, filename), buf);

    const putSpy = vi.spyOn(storage, 'put');

    const first = await migrateBoardImages({
      legacyDir,
      storage,
      filenameToBoardId: new Map([[filename, boardId]]),
      dryRun: false,
    });
    expect(first.migrated).toBe(1);

    const second = await migrateBoardImages({
      legacyDir,
      storage,
      filenameToBoardId: new Map([[filename, boardId]]),
      dryRun: false,
    });
    expect(second.alreadyInSync).toBe(1);
    expect(second.migrated).toBe(0);

    expect(putSpy).toHaveBeenCalledTimes(1);
    putSpy.mockRestore();
  });

  it('находит расхождение и не перезаписывает объект в storage', async () => {
    const filename = randomFilename();
    const boardId = randomUUID();
    const diskContent = Buffer.from('from-disk');
    const storageContent = Buffer.from('from-storage-different');
    writeFileSync(join(legacyDir, filename), diskContent);
    await storage.put(boardImageKey(boardId, filename), storageContent, 'image/webp');

    const report = await migrateBoardImages({
      legacyDir,
      storage,
      filenameToBoardId: new Map([[filename, boardId]]),
      dryRun: false,
    });

    expect(report.mismatches).toContain(filename);
    expect(report.migrated).toBe(0);

    const stored = storage.peek(boardImageKey(boardId, filename));
    expect(stored).toBeDefined();
    expect(sha256(stored!.body)).toBe(sha256(storageContent));
  });

  it('dry-run ничего не пишет в storage', async () => {
    const filename = randomFilename();
    const boardId = randomUUID();
    const buf = Buffer.from('board-image-content');
    writeFileSync(join(legacyDir, filename), buf);

    const report = await migrateBoardImages({
      legacyDir,
      storage,
      filenameToBoardId: new Map([[filename, boardId]]),
      dryRun: true,
    });

    expect(report.migrated).toBe(1);
    expect(report.scanned).toBe(1);
    expect(storage.peek(boardImageKey(boardId, filename))).toBeUndefined();
  });

  it('игнорирует файлы, не подходящие под FILENAME_RE', async () => {
    const filename = randomFilename();
    const boardId = randomUUID();
    writeFileSync(join(legacyDir, filename), Buffer.from('a'));
    writeFileSync(join(legacyDir, '.DS_Store'), Buffer.from('b'));
    writeFileSync(join(legacyDir, 'random-name.txt'), Buffer.from('c'));

    const report = await migrateBoardImages({
      legacyDir,
      storage,
      filenameToBoardId: new Map([[filename, boardId]]),
      dryRun: false,
    });

    expect(report.scanned).toBe(1);
  });

  it('никогда не удаляет исходный файл с диска', async () => {
    const filename = randomFilename();
    const boardId = randomUUID();
    const buf = Buffer.from('board-image-content');
    writeFileSync(join(legacyDir, filename), buf);

    await migrateBoardImages({
      legacyDir,
      storage,
      filenameToBoardId: new Map([[filename, boardId]]),
      dryRun: false,
    });

    expect(existsSync(join(legacyDir, filename))).toBe(true);
  });

  it('файл без записи в мэппинге — попадает в orphaned, не переносится', async () => {
    const filename = randomFilename();
    const buf = Buffer.from('orphan-content');
    writeFileSync(join(legacyDir, filename), buf);

    const report = await migrateBoardImages({
      legacyDir,
      storage,
      filenameToBoardId: new Map(),
      dryRun: false,
    });

    expect(report.scanned).toBe(1);
    expect(report.orphaned).toContain(filename);
    expect(report.migrated).toBe(0);
    expect(storage.peek(`boards/${randomUUID()}/images/${filename}`)).toBeUndefined();
  });

  it('два файла с разными boardId в мэппинге получают разные ключа в storage', async () => {
    const filenameA = randomFilename();
    const filenameB = randomFilename();
    const boardIdA = randomUUID();
    const boardIdB = randomUUID();
    writeFileSync(join(legacyDir, filenameA), Buffer.from('content-a'));
    writeFileSync(join(legacyDir, filenameB), Buffer.from('content-b'));

    await migrateBoardImages({
      legacyDir,
      storage,
      filenameToBoardId: new Map([
        [filenameA, boardIdA],
        [filenameB, boardIdB],
      ]),
      dryRun: false,
    });

    expect(storage.peek(boardImageKey(boardIdA, filenameA))).toBeDefined();
    expect(storage.peek(boardImageKey(boardIdB, filenameB))).toBeDefined();
    // файл A НЕ должен оказаться под ключом boardIdB и наоборот
    expect(storage.peek(boardImageKey(boardIdA, filenameB))).toBeUndefined();
    expect(storage.peek(boardImageKey(boardIdB, filenameA))).toBeUndefined();
  });
});

describeDb('buildFilenameToBoardId', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  const userIds: string[] = [];
  const boardIds: string[] = [];

  const authConfig: AuthConfig = {
    jwtSecret: 'секрет-для-тестов-длиннее-тридцати-двух-символов',
    guestSecret: 'гостевой-секрет-для-тестов-длиннее-тридцати-двух',
    publicOrigin: 'http://localhost:3000',
    webOrigin: 'http://localhost:5173',
    cookieSecure: false,
    providers: {},
  };

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

  async function newBoard(actorId: string): Promise<string> {
    const service = BoardsService.forDatabase(db, authConfig.guestSecret);
    const board = await service.create(actorId, {
      title: `Доска ${randomUUID().slice(0, 8)}`,
      teamId: null,
    });
    boardIds.push(board.id);
    return board.id;
  }

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl as string));
  });

  afterAll(async () => {
    try {
      if (boardIds.length > 0) {
        await db.delete(schema.boards).where(inArray(schema.boards.id, boardIds));
      }
      if (userIds.length > 0) {
        await db.delete(schema.users).where(inArray(schema.users.id, userIds));
      }
    } finally {
      await pool?.end();
    }
  });

  it('buildFilenameToBoardId сопоставляет filename → boardId по image-элементам', async () => {
    const owner = await newUser('map-image-owner');
    const boardId = await newBoard(owner.id);
    const filename = randomFilename();
    const url = boardImageUrl(boardId, filename);

    const service = BoardsService.forDatabase(db, authConfig.guestSecret);
    const itemId = randomUUID();
    await service.applyOps(
      { participantId: owner.id, userId: owner.id, name: owner.name },
      boardId,
      [
        {
          type: 'item.create',
          clientOpId: randomUUID(),
          item: {
            id: itemId,
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
        },
      ],
    );

    const map = await buildFilenameToBoardId(db);
    expect(map.get(filename)).toBe(boardId);
  });

  it('элемент с content.type !== "image" не попадает в мэппинг', async () => {
    const owner = await newUser('map-sticky-owner');
    const boardId = await newBoard(owner.id);

    // buildFilenameToBoardId сканирует ВЕСЬ board_items, а не только эту доску —
    // поэтому сравниваем «до» и «после», а не абсолютный размер
    const before = await buildFilenameToBoardId(db);

    const service = BoardsService.forDatabase(db, authConfig.guestSecret);
    await service.applyOps(
      { participantId: owner.id, userId: owner.id, name: owner.name },
      boardId,
      [
        {
          type: 'item.create',
          clientOpId: randomUUID(),
          item: {
            id: randomUUID(),
            parentId: null,
            x: 0,
            y: 0,
            width: 300,
            height: 200,
            rotation: 0,
            zIndex: 0,
            content: { type: 'sticky', text: 'это не картинка' },
            style: { color: '#FCEB96' },
            reactions: [],
          },
        },
      ],
    );

    const after = await buildFilenameToBoardId(db);
    // sticky-элемент не добавляет filename в мэппинг
    expect(after.size).toBe(before.size);
    // а доска из этого теста точно не в мэппинге — у неё нет image-элементов
    expect([...after.values()].some((bid) => bid === boardId)).toBe(false);
  });
});
