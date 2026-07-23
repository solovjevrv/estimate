/**
 * Интеграционные тесты API команд на реальной PostgreSQL: роуты, матрица прав
 * и инварианты владельца. Без DATABASE_URL — пропускаются.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { AuthUser } from '@poker/shared';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, signSession, upsertOAuthUser } from '../src/auth';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';
import { addMemberIfAbsent, createTeam, setMemberRole } from '../src/teams';

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
  const userIds: string[] = [];
  const teamIds: string[] = [];

  /** Заголовок с access-кукой указанного пользователя */
  function as(user: AuthUser): { cookie: string } {
    return { cookie: `${ACCESS_COOKIE}=${signSession(app.jwt, user.id).access}` };
  }

  async function newUser(label: string): Promise<AuthUser> {
    const id = randomUUID();
    const user = await upsertOAuthUser(db, 'google', {
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
    const team = await createTeam(db, `Команда ${randomUUID().slice(0, 8)}`, owner.id);
    teamIds.push(team.id);
    for (const [user, role] of members) {
      await addMemberIfAbsent(db, team.id, user.id, role);
    }
    return team.id;
  }

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl as string));
    app = buildApp({ db, auth: authConfig });
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
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
      await setMemberRole(db, teamId, guest.id, 'admin', owner.id);
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

  describe('исключение и выход', () => {
    it('администратор исключает участника, но не владельца и не другого админа', async () => {
      const owner = await newUser('kick-owner');
      const admin = await newUser('kick-admin');
      const admin2 = await newUser('kick-admin2');
      const member = await newUser('kick-member');
      const teamId = await newTeam(owner, [
        [admin, 'admin'],
        [admin2, 'admin'],
        [member, 'member'],
      ]);

      const kickOwner = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${owner.id}`,
        headers: as(admin),
      });
      const kickAdmin = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${admin2.id}`,
        headers: as(admin),
      });
      const kickMember = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${member.id}`,
        headers: as(admin),
      });

      expect(kickOwner.statusCode).toBe(403);
      expect(kickAdmin.statusCode).toBe(403);
      expect(kickMember.statusCode).toBe(204);
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
