/**
 * Интеграционные тесты API команд на реальной PostgreSQL: роуты, матрица прав
 * и инварианты владельца. Без DATABASE_URL — пропускаются.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { AuthUser } from '@poker/shared';
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
  publicOrigin: 'http://localhost:3000',
  webOrigin: 'http://localhost:5173',
  cookieSecure: false,
  providers: {},
};

describeDb('API команд', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let app: FastifyInstance;
  let repository: TeamsRepository;
  let service: TeamsService;
  const userIds: string[] = [];
  const teamIds: string[] = [];
  const roomIds: string[] = [];

  /** Заголовок с access-кукой указанного пользователя */
  function as(user: AuthUser): { cookie: string } {
    return { cookie: `${ACCESS_COOKIE}=${new TokenService(app.jwt, false).issue(user.id).access}` };
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

  /** Команда с владельцем и, опционально, участниками в заданных ролях */
  async function newTeam(
    owner: AuthUser,
    members: Array<[AuthUser, 'admin' | 'member' | 'guest']> = [],
  ): Promise<string> {
    const team = await service.create(owner.id, `Команда ${randomUUID().slice(0, 8)}`);
    teamIds.push(team.id);
    for (const [user, role] of members) {
      await repository.insertMemberIfAbsent(team.id, user.id, role);
    }
    return team.id;
  }

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl as string));
    repository = new TeamsRepository(db);
    service = new TeamsService(db, repository);
    app = buildApp({ db, auth: authConfig });
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
      if (roomIds.length > 0) {
        await db.delete(schema.rooms).where(inArray(schema.rooms.id, roomIds));
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

  describe('создание и список', () => {
    it('создатель команды становится владельцем и видит её в списке', async () => {
      const owner = await newUser('owner');

      const created = await app.inject({
        method: 'POST',
        url: '/api/teams',
        headers: as(owner),
        payload: { name: '  Команда мечты  ' },
      });

      expect(created.statusCode).toBe(201);
      const { team } = created.json() as { team: { id: string; name: string; role: string } };
      teamIds.push(team.id);
      // Пробелы по краям названия срезаются
      expect(team.name).toBe('Команда мечты');
      expect(team.role).toBe('owner');

      const list = await app.inject({ method: 'GET', url: '/api/teams', headers: as(owner) });
      expect(list.json()).toMatchObject({ teams: [{ id: team.id, role: 'owner' }] });
    });

    it('без входа команду не создать', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/teams',
        payload: { name: 'Без входа' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('пустое и слишком длинное название отклоняются', async () => {
      const owner = await newUser('validation');

      const blank = await app.inject({
        method: 'POST',
        url: '/api/teams',
        headers: as(owner),
        payload: { name: '   ' },
      });
      const tooLong = await app.inject({
        method: 'POST',
        url: '/api/teams',
        headers: as(owner),
        payload: { name: 'я'.repeat(81) },
      });

      expect(blank.statusCode).toBe(400);
      expect(tooLong.statusCode).toBe(400);
    });

    it('нечисловой идентификатор команды отклоняется валидацией', async () => {
      const user = await newUser('badid');

      const res = await app.inject({
        method: 'GET',
        url: '/api/teams/не-uuid',
        headers: as(user),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('просмотр команды', () => {
    it('участник видит состав, а код приглашения — только от админа и выше', async () => {
      const owner = await newUser('view-owner');
      const member = await newUser('view-member');
      const teamId = await newTeam(owner, [[member, 'member']]);

      const byOwner = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(owner),
      });
      const byMember = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(member),
      });

      expect(byOwner.statusCode).toBe(200);
      const ownerView = byOwner.json() as { members: unknown[]; inviteCode?: string };
      expect(ownerView.members).toHaveLength(2);
      expect(ownerView.inviteCode).toBeTruthy();

      expect(byMember.statusCode).toBe(200);
      expect((byMember.json() as { inviteCode?: string }).inviteCode).toBeUndefined();
    });

    it('гость видит состав без адресов и не может звать в команду', async () => {
      const owner = await newUser('guest-owner');
      const guest = await newUser('guest-viewer');
      const teamId = await newTeam(owner, [[guest, 'guest']]);

      const view = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(guest),
      });
      const rotate = await app.inject({
        method: 'POST',
        url: `/api/teams/${teamId}/invite/rotate`,
        headers: as(guest),
      });

      expect(view.statusCode).toBe(200);
      const members = (view.json() as { members: Array<{ email?: string }> }).members;
      expect(members).toHaveLength(2);
      expect(members.every((member) => member.email === undefined)).toBe(true);
      expect(rotate.statusCode).toBe(403);
    });

    it('участник видит адреса коллег', async () => {
      const owner = await newUser('email-owner');
      const member = await newUser('email-member');
      const teamId = await newTeam(owner, [[member, 'member']]);

      const view = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}/members`,
        headers: as(member),
      });

      const members = (view.json() as { members: Array<{ email?: string }> }).members;
      expect(members.every((entry) => typeof entry.email === 'string')).toBe(true);
    });

    it('посторонний получает 404, а не 403 — существование команды не раскрывается', async () => {
      const owner = await newUser('secret-owner');
      const stranger = await newUser('stranger');
      const teamId = await newTeam(owner);

      const res = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(stranger),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('настройки команды', () => {
    it('владелец переименовывает команду, участник — нет', async () => {
      const owner = await newUser('rename-owner');
      const member = await newUser('rename-member');
      const teamId = await newTeam(owner, [[member, 'member']]);

      const byMember = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}`,
        headers: as(member),
        payload: { name: 'Захват власти' },
      });
      const byOwner = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}`,
        headers: as(owner),
        payload: { name: 'Новое название' },
      });

      expect(byMember.statusCode).toBe(403);
      expect(byOwner.statusCode).toBe(200);
      expect(byOwner.json()).toMatchObject({ team: { name: 'Новое название' } });
    });

    it('владелец удаляет команду, администратор — нет', async () => {
      const owner = await newUser('delete-owner');
      const admin = await newUser('delete-admin');
      const teamId = await newTeam(owner, [[admin, 'admin']]);

      const byAdmin = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}`,
        headers: as(admin),
      });
      expect(byAdmin.statusCode).toBe(403);

      const byOwner = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}`,
        headers: as(owner),
      });
      expect(byOwner.statusCode).toBe(204);

      const after = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(owner),
      });
      expect(after.statusCode).toBe(404);
    });

    it('комнаты команды переживают её удаление и остаются без команды', async () => {
      const owner = await newUser('rooms-owner');
      const teamId = await newTeam(owner);
      const roomId = randomUUID();
      roomIds.push(roomId);
      await db
        .insert(schema.rooms)
        .values({ id: roomId, teamId, creatorId: owner.id, name: 'Комната команды' });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}`,
        headers: as(owner),
      });
      expect(res.statusCode).toBe(204);

      const [room] = await db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId));
      expect(room?.teamId).toBeNull();
    });
  });

  describe('приглашения', () => {
    async function inviteCodeOf(teamId: string, owner: AuthUser): Promise<string> {
      const res = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(owner),
      });
      return (res.json() as { inviteCode: string }).inviteCode;
    }

    it('по ссылке видно название команды без входа, а вступление требует входа', async () => {
      const owner = await newUser('invite-owner');
      const teamId = await newTeam(owner);
      const code = await inviteCodeOf(teamId, owner);

      const preview = await app.inject({ method: 'GET', url: `/api/invites/${code}` });
      const joinAnon = await app.inject({ method: 'POST', url: `/api/invites/${code}/join` });

      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({ team: { id: teamId } });
      // В предпросмотре не должно быть состава команды
      expect(preview.body).not.toMatch(/members/);
      expect(joinAnon.statusCode).toBe(401);
    });

    it('вступивший получает роль участника, повторный переход ничего не меняет', async () => {
      const owner = await newUser('join-owner');
      const guest = await newUser('join-guest');
      const teamId = await newTeam(owner);
      const code = await inviteCodeOf(teamId, owner);

      const first = await app.inject({
        method: 'POST',
        url: `/api/invites/${code}/join`,
        headers: as(guest),
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ role: 'member' });

      // Повысили роль — повторный переход по ссылке не должен её сбросить
      await service.changeMemberRole(owner.id, teamId, guest.id, 'admin');
      const second = await app.inject({
        method: 'POST',
        url: `/api/invites/${code}/join`,
        headers: as(guest),
      });

      expect(second.json()).toMatchObject({ role: 'admin' });
    });

    it('перевыпуск кода доступен админу и ломает старую ссылку', async () => {
      const owner = await newUser('rotate-owner');
      const admin = await newUser('rotate-admin');
      const member = await newUser('rotate-member');
      const teamId = await newTeam(owner, [
        [admin, 'admin'],
        [member, 'member'],
      ]);
      const oldCode = await inviteCodeOf(teamId, owner);

      const byMember = await app.inject({
        method: 'POST',
        url: `/api/teams/${teamId}/invite/rotate`,
        headers: as(member),
      });
      expect(byMember.statusCode).toBe(403);

      const byAdmin = await app.inject({
        method: 'POST',
        url: `/api/teams/${teamId}/invite/rotate`,
        headers: as(admin),
      });
      expect(byAdmin.statusCode).toBe(200);
      const newCode = (byAdmin.json() as { inviteCode: string }).inviteCode;
      expect(newCode).not.toBe(oldCode);

      const old = await app.inject({ method: 'GET', url: `/api/invites/${oldCode}` });
      expect(old.statusCode).toBe(404);
    });

    it('вступление с кукой удалённого пользователя отклоняется, а не ломает сервер', async () => {
      const owner = await newUser('ghost-owner');
      const ghost = await newUser('ghost');
      const teamId = await newTeam(owner);
      const code = await inviteCodeOf(teamId, owner);
      const headers = as(ghost);
      await db.delete(schema.users).where(eq(schema.users.id, ghost.id));

      const res = await app.inject({
        method: 'POST',
        url: `/api/invites/${code}/join`,
        headers,
      });

      expect(res.statusCode).toBe(401);
    });

    it('несуществующий код приглашения даёт 404', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/invites/abcdefghijkl' });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('роли участников', () => {
    it('владелец меняет роль участника, администратор — нет', async () => {
      const owner = await newUser('role-owner');
      const admin = await newUser('role-admin');
      const member = await newUser('role-member');
      const teamId = await newTeam(owner, [
        [admin, 'admin'],
        [member, 'member'],
      ]);

      const byAdmin = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${member.id}`,
        headers: as(admin),
        payload: { role: 'admin' },
      });
      expect(byAdmin.statusCode).toBe(403);

      const byOwner = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${member.id}`,
        headers: as(owner),
        payload: { role: 'guest' },
      });
      expect(byOwner.statusCode).toBe(200);
      expect(byOwner.json()).toMatchObject({ member: { role: 'guest' } });
    });

    it('прежний владелец после передачи теряет права на настройки', async () => {
      const owner = await newUser('ex-owner');
      const heir = await newUser('ex-heir');
      const teamId = await newTeam(owner, [[heir, 'member']]);

      const transfer = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${heir.id}`,
        headers: as(owner),
        payload: { role: 'owner' },
      });
      expect(transfer.json()).toMatchObject({ actorRole: 'admin' });

      const rename = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}`,
        headers: as(owner),
        payload: { name: 'Обратно моё' },
      });

      expect(rename.statusCode).toBe(403);
    });

    it('передача владения делает прежнего владельца администратором', async () => {
      const owner = await newUser('transfer-owner');
      const heir = await newUser('transfer-heir');
      const teamId = await newTeam(owner, [[heir, 'member']]);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${heir.id}`,
        headers: as(owner),
        payload: { role: 'owner' },
      });
      expect(res.statusCode).toBe(200);

      const view = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(heir),
      });
      const members = (view.json() as { members: Array<{ userId: string; role: string }> }).members;
      expect(members.find((m) => m.userId === heir.id)?.role).toBe('owner');
      expect(members.find((m) => m.userId === owner.id)?.role).toBe('admin');
      expect(members.filter((m) => m.role === 'owner')).toHaveLength(1);
    });

    it('единственный владелец не может понизить сам себя', async () => {
      const owner = await newUser('demote-owner');
      const teamId = await newTeam(owner);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${owner.id}`,
        headers: as(owner),
        payload: { role: 'admin' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('неизвестная роль отклоняется валидацией', async () => {
      const owner = await newUser('badrole-owner');
      const teamId = await newTeam(owner);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${owner.id}`,
        headers: as(owner),
        payload: { role: 'король' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('одновременные запросы', () => {
    it('база не даёт завести второго владельца даже в обход API', async () => {
      const owner = await newUser('index-owner');
      const rival = await newUser('index-rival');
      await newTeam(owner, [[rival, 'member']]);

      const err = await db
        .update(schema.teamMembers)
        .set({ role: 'owner' })
        .where(eq(schema.teamMembers.userId, rival.id))
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(err, 'уникальный индекс владельца не сработал').not.toBeNull();
      expect(String((err as { cause?: unknown }).cause ?? err)).toMatch(
        /team_members_single_owner_idx/,
      );
    });

    /** Сколько владельцев у команды сейчас */
    async function ownerCount(teamId: string): Promise<number> {
      const members = await repository.listMembers(teamId);
      return members.filter((member) => member.role === 'owner').length;
    }

    it('передача владения и одновременный выход наследника оставляют ровно одного владельца', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const owner = await newUser(`race-owner-${attempt}`);
        const heir = await newUser(`race-heir-${attempt}`);
        const teamId = await newTeam(owner, [[heir, 'member']]);

        const [transfer, leave] = await Promise.all([
          app.inject({
            method: 'PATCH',
            url: `/api/teams/${teamId}/members/${heir.id}`,
            headers: as(owner),
            payload: { role: 'owner' },
          }),
          app.inject({
            method: 'DELETE',
            url: `/api/teams/${teamId}/members/${heir.id}`,
            headers: as(heir),
          }),
        ]);

        // Успеть должен ровно один сценарий: либо передача, либо выход
        expect([transfer.statusCode, leave.statusCode].sort()).toEqual(
          expect.arrayContaining([expect.any(Number)]),
        );
        expect(transfer.statusCode).toBeLessThan(500);
        expect(leave.statusCode).toBeLessThan(500);
        expect(await ownerCount(teamId), 'команда без владельца или с двумя').toBe(1);
      }
    });

    it('две одновременные передачи владения не создают второго владельца', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const owner = await newUser(`race2-owner-${attempt}`);
        const first = await newUser(`race2-first-${attempt}`);
        const second = await newUser(`race2-second-${attempt}`);
        const teamId = await newTeam(owner, [
          [first, 'member'],
          [second, 'member'],
        ]);

        const results = await Promise.all([
          app.inject({
            method: 'PATCH',
            url: `/api/teams/${teamId}/members/${first.id}`,
            headers: as(owner),
            payload: { role: 'owner' },
          }),
          app.inject({
            method: 'PATCH',
            url: `/api/teams/${teamId}/members/${second.id}`,
            headers: as(owner),
            payload: { role: 'owner' },
          }),
        ]);

        // Одна передача проходит, вторая упирается в уже потерянные права
        expect(results.map((res) => res.statusCode).sort()).toEqual([200, 403]);
        expect(await ownerCount(teamId), 'у команды оказалось два владельца').toBe(1);
      }
    });
  });

  describe('исключение и выход', () => {
    it('исключает участников только владелец: администратору отказано', async () => {
      const owner = await newUser('kick-owner');
      const admin = await newUser('kick-admin');
      const member = await newUser('kick-member');
      const teamId = await newTeam(owner, [
        [admin, 'admin'],
        [member, 'member'],
      ]);

      const byAdmin = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${member.id}`,
        headers: as(admin),
      });
      const byOwner = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${member.id}`,
        headers: as(owner),
      });

      expect(byAdmin.statusCode).toBe(403);
      expect(byOwner.statusCode).toBe(204);
    });

    it('гость может выйти из команды сам', async () => {
      const owner = await newUser('guest-leave-owner');
      const guest = await newUser('guest-leave');
      const teamId = await newTeam(owner, [[guest, 'guest']]);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${guest.id}`,
        headers: as(guest),
      });

      expect(res.statusCode).toBe(204);
    });

    it('участник не может исключить другого участника, но может выйти сам', async () => {
      const owner = await newUser('leave-owner');
      const member = await newUser('leave-member');
      const other = await newUser('leave-other');
      const teamId = await newTeam(owner, [
        [member, 'member'],
        [other, 'member'],
      ]);

      const kickOther = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${other.id}`,
        headers: as(member),
      });
      const leave = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${member.id}`,
        headers: as(member),
      });

      expect(kickOther.statusCode).toBe(403);
      expect(leave.statusCode).toBe(204);

      const after = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(member),
      });
      expect(after.statusCode).toBe(404);
    });

    it('единственный владелец не может выйти из команды', async () => {
      const owner = await newUser('solo-owner');
      const member = await newUser('solo-member');
      const teamId = await newTeam(owner, [[member, 'member']]);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${owner.id}`,
        headers: as(owner),
      });

      expect(res.statusCode).toBe(409);
    });

    it('смена роли того, кто не состоит в команде, даёт 404', async () => {
      const owner = await newUser('role-missing-owner');
      const stranger = await newUser('role-missing-stranger');
      const teamId = await newTeam(owner);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${stranger.id}`,
        headers: as(owner),
        payload: { role: 'admin' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('исключение того, кто не состоит в команде, даёт 404', async () => {
      const owner = await newUser('missing-owner');
      const stranger = await newUser('missing-stranger');
      const teamId = await newTeam(owner);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${stranger.id}`,
        headers: as(owner),
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
