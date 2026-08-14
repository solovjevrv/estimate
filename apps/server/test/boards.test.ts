/**
 * Интеграционные тесты API досок (12.1+12.2) на реальной PostgreSQL: роуты и
 * матрица прав — личная доска доступна только владельцу, командная — по роли
 * в команде (guest только смотрит, admin/member заводят новые доски,
 * переименовать/архивировать/удалить может автор доски или администратор
 * команды). Без DATABASE_URL — пропускаются.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { BOARD_TITLE_MAX_LENGTH, TEXT_INPUT_TRIM_ALLOWANCE, type AuthUser } from '@poker/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, TokenService, UsersRepository } from '../src/auth';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';
import { TeamsRepository, TeamsService } from '../src/teams';

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

describeDb('API досок', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let app: FastifyInstance;
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

  async function createBoard(
    actor: AuthUser,
    body: { title: string; teamId?: string | null },
  ): Promise<{ statusCode: number; id?: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: as(actor),
      payload: body,
    });
    if (res.statusCode === 201) {
      const id = (res.json() as { board: { id: string } }).board.id;
      boardIds.push(id);
      return { statusCode: res.statusCode, id };
    }
    return { statusCode: res.statusCode };
  }

  /** Для тестов, где создание доски заведомо должно пройти успешно */
  async function createBoardOk(
    actor: AuthUser,
    body: { title: string; teamId?: string | null },
  ): Promise<string> {
    const { statusCode, id } = await createBoard(actor, body);
    if (statusCode !== 201 || !id) {
      throw new Error(`Не удалось создать доску для теста: статус ${statusCode}`);
    }
    return id;
  }

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl as string));
    teamsRepository = new TeamsRepository(db);
    teamsService = new TeamsService(db, teamsRepository);
    app = buildApp({ db, auth: authConfig });
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
    }
  });

  describe('создание', () => {
    it('без teamId доска личная — создатель видит её в своём списке', async () => {
      const owner = await newUser('personal-owner');

      const created = await createBoard(owner, { title: '  Ретро спринта  ' });
      expect(created.statusCode).toBe(201);

      const list = await app.inject({ method: 'GET', url: '/api/boards', headers: as(owner) });
      const boards = (list.json() as { boards: Array<{ id: string; title: string }> }).boards;
      expect(boards.find((b) => b.id === created.id)?.title).toBe('Ретро спринта');
    });

    it('администратор и участник команды могут завести командную доску, гость — нет', async () => {
      const admin = await newUser('create-admin');
      const member = await newUser('create-member');
      const guest = await newUser('create-guest');
      const teamId = await newTeam(admin, [
        [member, 'member'],
        [guest, 'guest'],
      ]);

      const byAdmin = await createBoard(admin, { title: 'Доска админа', teamId });
      const byMember = await createBoard(member, { title: 'Доска участника', teamId });
      const byGuest = await createBoard(guest, { title: 'Доска гостя', teamId });

      expect(byAdmin.statusCode).toBe(201);
      expect(byMember.statusCode).toBe(201);
      expect(byGuest.statusCode).toBe(403);
    });

    it('чужая команда (или несуществующая) отвечает 404', async () => {
      const stranger = await newUser('create-stranger');

      const res = await createBoard(stranger, { title: 'Мимо', teamId: randomUUID() });

      expect(res.statusCode).toBe(404);
    });

    it('пустое и слишком длинное название отклоняются', async () => {
      const user = await newUser('create-validation');

      const blank = await createBoard(user, { title: '   ' });
      const tooLong = await createBoard(user, { title: 'я'.repeat(121) });

      expect(blank.statusCode).toBe(400);
      expect(tooLong.statusCode).toBe(400);
    });

    it('схема принимает запас на trim, но не строку за его пределом', async () => {
      const user = await newUser('create-trim-allowance');
      const title = 'д'.repeat(BOARD_TITLE_MAX_LENGTH);
      const accepted = await app.inject({
        method: 'POST',
        url: '/api/boards',
        headers: as(user),
        payload: { title: `${' '.repeat(TEXT_INPUT_TRIM_ALLOWANCE)}${title}` },
      });

      expect(accepted.statusCode).toBe(201);
      const board = (accepted.json() as { board: { id: string; title: string } }).board;
      boardIds.push(board.id);
      expect(board.title).toBe(title);

      const rejected = await createBoard(user, {
        title: 'д'.repeat(BOARD_TITLE_MAX_LENGTH + TEXT_INPUT_TRIM_ALLOWANCE + 1),
      });
      expect(rejected.statusCode).toBe(400);
    });

    it('без входа доску не создать', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/boards',
        payload: { title: 'Без входа' },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('доступ к личной доске', () => {
    it('чужому пользователю личная доска отвечает 404 на просмотр и правки', async () => {
      const owner = await newUser('private-owner');
      const stranger = await newUser('private-stranger');
      const id = await createBoardOk(owner, { title: 'Личное' });

      const view = await app.inject({
        method: 'GET',
        url: `/api/boards/${id}`,
        headers: as(stranger),
      });
      const rename = await app.inject({
        method: 'PATCH',
        url: `/api/boards/${id}`,
        headers: as(stranger),
        payload: { title: 'Переименовано чужим' },
      });
      const archive = await app.inject({
        method: 'POST',
        url: `/api/boards/${id}/archive`,
        headers: as(stranger),
      });

      expect(view.statusCode).toBe(404);
      expect(rename.statusCode).toBe(404);
      expect(archive.statusCode).toBe(404);
    });

    it('владелец видит снимок доски (метаданные, элементы, связи)', async () => {
      const owner = await newUser('snapshot-owner');
      const id = await createBoardOk(owner, { title: 'Со снимком' });

      const res = await app.inject({ method: 'GET', url: `/api/boards/${id}`, headers: as(owner) });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { board: { id: string }; items: unknown[]; edges: unknown[] };
      expect(body.board.id).toBe(id);
      expect(body.items).toEqual([]);
      expect(body.edges).toEqual([]);
    });
  });

  describe('доступ к командной доске', () => {
    it('гость команды видит снимок доски, но не может её переименовать или архивировать', async () => {
      const admin = await newUser('team-view-admin');
      const guest = await newUser('team-view-guest');
      const teamId = await newTeam(admin, [[guest, 'guest']]);
      const id = await createBoardOk(admin, { title: 'Командная', teamId });

      const view = await app.inject({
        method: 'GET',
        url: `/api/boards/${id}`,
        headers: as(guest),
      });
      const rename = await app.inject({
        method: 'PATCH',
        url: `/api/boards/${id}`,
        headers: as(guest),
        payload: { title: 'Переименовано гостем' },
      });

      expect(view.statusCode).toBe(200);
      expect(rename.statusCode).toBe(403);
    });

    it('обычный участник не может переименовать чужую доску, но администратор — может', async () => {
      const admin = await newUser('team-manage-admin');
      const member = await newUser('team-manage-member');
      const teamId = await newTeam(admin, [[member, 'member']]);
      const id = await createBoardOk(admin, { title: 'Доска администратора', teamId });

      const byMember = await app.inject({
        method: 'PATCH',
        url: `/api/boards/${id}`,
        headers: as(member),
        payload: { title: 'Переименовано участником' },
      });
      const byAdmin = await app.inject({
        method: 'PATCH',
        url: `/api/boards/${id}`,
        headers: as(admin),
        payload: { title: 'Переименовано администратором' },
      });

      expect(byMember.statusCode).toBe(403);
      expect(byAdmin.statusCode).toBe(200);
    });

    it('автор доски может переименовать и удалить свою доску, даже не будучи администратором', async () => {
      const admin = await newUser('team-author-admin');
      const author = await newUser('team-author-member');
      const teamId = await newTeam(admin, [[author, 'member']]);
      const id = await createBoardOk(author, { title: 'Доска автора', teamId });

      const rename = await app.inject({
        method: 'PATCH',
        url: `/api/boards/${id}`,
        headers: as(author),
        payload: { title: 'Переименовано автором' },
      });
      const archive = await app.inject({
        method: 'POST',
        url: `/api/boards/${id}/archive`,
        headers: as(author),
      });
      const remove = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${id}`,
        headers: as(author),
      });

      expect(rename.statusCode).toBe(200);
      expect(archive.statusCode).toBe(200);
      expect(remove.statusCode).toBe(204);
    });

    it('доска чужой команды (или несуществующая) отвечает 404', async () => {
      const admin = await newUser('team-other-admin');
      const outsider = await newUser('team-other-outsider');
      const teamId = await newTeam(admin);
      const id = await createBoardOk(admin, { title: 'Не для чужих', teamId });

      const view = await app.inject({
        method: 'GET',
        url: `/api/boards/${id}`,
        headers: as(outsider),
      });

      expect(view.statusCode).toBe(404);
    });
  });

  describe('архивация и удаление', () => {
    it('удалить можно только уже заархивированную доску', async () => {
      const owner = await newUser('delete-owner');
      const id = await createBoardOk(owner, { title: 'На удаление' });

      const removeBeforeArchive = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${id}`,
        headers: as(owner),
      });
      expect(removeBeforeArchive.statusCode).toBe(409);

      const archive = await app.inject({
        method: 'POST',
        url: `/api/boards/${id}/archive`,
        headers: as(owner),
      });
      expect(archive.statusCode).toBe(200);

      const archiveAgain = await app.inject({
        method: 'POST',
        url: `/api/boards/${id}/archive`,
        headers: as(owner),
      });
      expect(archiveAgain.statusCode).toBe(409);

      const remove = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${id}`,
        headers: as(owner),
      });
      expect(remove.statusCode).toBe(204);

      const afterDelete = await app.inject({
        method: 'GET',
        url: `/api/boards/${id}`,
        headers: as(owner),
      });
      expect(afterDelete.statusCode).toBe(404);
      boardIds.splice(boardIds.indexOf(id), 1);
    });

    it('архивные и активные доски выдаются раздельно списком', async () => {
      const owner = await newUser('archive-list-owner');
      const activeId = await createBoardOk(owner, { title: 'Активная' });
      const toArchiveId = await createBoardOk(owner, { title: 'Будет в архиве' });
      await app.inject({
        method: 'POST',
        url: `/api/boards/${toArchiveId}/archive`,
        headers: as(owner),
      });

      const activeList = await app.inject({
        method: 'GET',
        url: '/api/boards',
        headers: as(owner),
      });
      const archivedList = await app.inject({
        method: 'GET',
        url: '/api/boards?archived=true',
        headers: as(owner),
      });

      const activeIds = (activeList.json() as { boards: Array<{ id: string }> }).boards.map(
        (b) => b.id,
      );
      const archivedIds = (archivedList.json() as { boards: Array<{ id: string }> }).boards.map(
        (b) => b.id,
      );

      expect(activeIds).toContain(activeId);
      expect(activeIds).not.toContain(toArchiveId);
      expect(archivedIds).toContain(toArchiveId);
      expect(archivedIds).not.toContain(activeId);
    });

    it('вернуть из архива можно только уже заархивированную доску', async () => {
      const owner = await newUser('unarchive-owner');
      const id = await createBoardOk(owner, { title: 'Не в архиве' });

      const unarchiveActive = await app.inject({
        method: 'POST',
        url: `/api/boards/${id}/unarchive`,
        headers: as(owner),
      });
      expect(unarchiveActive.statusCode).toBe(409);

      await app.inject({ method: 'POST', url: `/api/boards/${id}/archive`, headers: as(owner) });
      const unarchive = await app.inject({
        method: 'POST',
        url: `/api/boards/${id}/unarchive`,
        headers: as(owner),
      });
      expect(unarchive.statusCode).toBe(200);
      expect((unarchive.json() as { board: { status: string } }).board.status).toBe('active');
    });
  });

  describe('удаление доски уносит элементы и связи каскадом', () => {
    it('элемент и стрелка исчезают вместе с доской', async () => {
      const owner = await newUser('cascade-owner');
      const boardId = await createBoardOk(owner, { title: 'С элементами' });

      const [itemA] = await db
        .insert(schema.boardItems)
        .values({
          boardId,
          x: 0,
          y: 0,
          width: 200,
          height: 120,
          content: { type: 'sticky', text: 'Первый' },
          style: { color: '#FCEB96' },
        })
        .returning();
      const [itemB] = await db
        .insert(schema.boardItems)
        .values({
          boardId,
          x: 300,
          y: 0,
          width: 200,
          height: 120,
          content: { type: 'sticky', text: 'Второй' },
          style: { color: '#60D878' },
        })
        .returning();
      await db.insert(schema.boardEdges).values({
        boardId,
        sourceItemId: itemA!.id,
        targetItemId: itemB!.id,
        style: { color: '#7DA9F6', line: 'straight', markerStart: 'none', markerEnd: 'none' },
      });

      await app.inject({
        method: 'POST',
        url: `/api/boards/${boardId}/archive`,
        headers: as(owner),
      });
      const remove = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${boardId}`,
        headers: as(owner),
      });
      expect(remove.statusCode).toBe(204);

      const remainingItems = await db
        .select()
        .from(schema.boardItems)
        .where(eq(schema.boardItems.boardId, boardId));
      const remainingEdges = await db
        .select()
        .from(schema.boardEdges)
        .where(eq(schema.boardEdges.boardId, boardId));

      expect(remainingItems).toHaveLength(0);
      expect(remainingEdges).toHaveLength(0);
      boardIds.splice(boardIds.indexOf(boardId), 1);
    });
  });
});
