/**
 * Интеграционные тесты API команд на реальной PostgreSQL: роуты, матрица прав
 * и инвариант «в команде всегда есть хотя бы один администратор». Админов
 * может быть несколько — все равны в правах. Без DATABASE_URL — пропускаются.
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

  /** Команда с администратором-создателем и, опционально, участниками в заданных ролях */
  async function newTeam(
    creator: AuthUser,
    members: Array<[AuthUser, 'admin' | 'member' | 'guest']> = [],
  ): Promise<string> {
    const team = await service.create(creator.id, `Команда ${randomUUID().slice(0, 8)}`);
    teamIds.push(team.id);
    for (const [user, role] of members) {
      await repository.insertMemberIfAbsent(team.id, user.id, role);
    }
    return team.id;
  }

  /** Сколько администраторов у команды сейчас */
  async function adminCount(teamId: string): Promise<number> {
    const members = await repository.listMembers(teamId);
    return members.filter((member) => member.role === 'admin').length;
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
    it('создатель команды становится администратором и видит её в списке', async () => {
      const admin = await newUser('admin');

      const created = await app.inject({
        method: 'POST',
        url: '/api/teams',
        headers: as(admin),
        payload: { name: '  Команда мечты  ' },
      });

      expect(created.statusCode).toBe(201);
      const { team } = created.json() as { team: { id: string; name: string; role: string } };
      teamIds.push(team.id);
      // Пробелы по краям названия срезаются
      expect(team.name).toBe('Команда мечты');
      expect(team.role).toBe('admin');

      const list = await app.inject({ method: 'GET', url: '/api/teams', headers: as(admin) });
      expect(list.json()).toMatchObject({
        teams: [{ id: team.id, role: 'admin', memberCount: 1 }],
      });
    });

    it('список команд отдаёт число участников каждой — не только видимых в составе', async () => {
      const admin = await newUser('count-admin');
      const memberA = await newUser('count-member-a');
      const memberB = await newUser('count-member-b');
      const soloTeamId = await newTeam(admin);
      const groupTeamId = await newTeam(admin, [
        [memberA, 'member'],
        [memberB, 'guest'],
      ]);

      const list = await app.inject({ method: 'GET', url: '/api/teams', headers: as(admin) });
      const teams = (list.json() as { teams: Array<{ id: string; memberCount: number }> }).teams;

      expect(teams.find((t) => t.id === soloTeamId)?.memberCount).toBe(1);
      expect(teams.find((t) => t.id === groupTeamId)?.memberCount).toBe(3);

      // Счётчик считает ВСЕХ участников, а не только тех, кого видит смотрящий
      const memberView = await app.inject({
        method: 'GET',
        url: '/api/teams',
        headers: as(memberA),
      });
      const memberTeams = (
        memberView.json() as { teams: Array<{ id: string; memberCount: number }> }
      ).teams;
      expect(memberTeams.find((t) => t.id === groupTeamId)?.memberCount).toBe(3);
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
      const admin = await newUser('validation');

      const blank = await app.inject({
        method: 'POST',
        url: '/api/teams',
        headers: as(admin),
        payload: { name: '   ' },
      });
      const tooLong = await app.inject({
        method: 'POST',
        url: '/api/teams',
        headers: as(admin),
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
    it('участник видит состав, а код приглашения — только администратору', async () => {
      const admin = await newUser('view-admin');
      const member = await newUser('view-member');
      const teamId = await newTeam(admin, [[member, 'member']]);

      const byAdmin = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(admin),
      });
      const byMember = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(member),
      });

      expect(byAdmin.statusCode).toBe(200);
      const adminView = byAdmin.json() as { members: unknown[]; inviteCode?: string };
      expect(adminView.members).toHaveLength(2);
      expect(adminView.inviteCode).toBeTruthy();

      expect(byMember.statusCode).toBe(200);
      expect((byMember.json() as { inviteCode?: string }).inviteCode).toBeUndefined();
    });

    it('гость видит состав без адресов и не может звать в команду', async () => {
      const admin = await newUser('guest-admin');
      const guest = await newUser('guest-viewer');
      const teamId = await newTeam(admin, [[guest, 'guest']]);

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
      const admin = await newUser('email-admin');
      const member = await newUser('email-member');
      const teamId = await newTeam(admin, [[member, 'member']]);

      const view = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}/members`,
        headers: as(member),
      });

      const members = (view.json() as { members: Array<{ email?: string }> }).members;
      expect(members.every((entry) => typeof entry.email === 'string')).toBe(true);
    });

    it('в составе команды показывается имя, изменённое в профиле (9.2), а не имя от провайдера', async () => {
      const admin = await newUser('display-name-admin');
      const member = await newUser('display-name-member');
      const teamId = await newTeam(admin, [[member, 'member']]);
      await new UsersRepository(db).updateProfile(member.id, {
        name: 'Псевдоним из профиля',
        jobTitle: null,
      });

      const view = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}/members`,
        headers: as(admin),
      });

      const members = (view.json() as { members: Array<{ userId: string; name: string }> }).members;
      const changed = members.find((entry) => entry.userId === member.id);
      expect(changed?.name).toBe('Псевдоним из профиля');
    });

    it('посторонний получает 404, а не 403 — существование команды не раскрывается', async () => {
      const admin = await newUser('secret-admin');
      const stranger = await newUser('stranger');
      const teamId = await newTeam(admin);

      const res = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(stranger),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('настройки команды', () => {
    it('администратор переименовывает команду, участник — нет', async () => {
      const admin = await newUser('rename-admin');
      const member = await newUser('rename-member');
      const teamId = await newTeam(admin, [[member, 'member']]);

      const byMember = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}`,
        headers: as(member),
        payload: { name: 'Захват власти' },
      });
      const byAdmin = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}`,
        headers: as(admin),
        payload: { name: 'Новое название' },
      });

      expect(byMember.statusCode).toBe(403);
      expect(byAdmin.statusCode).toBe(200);
      expect(byAdmin.json()).toMatchObject({ team: { name: 'Новое название' } });
    });

    it('любой администратор может удалить команду, не только создатель', async () => {
      const admin1 = await newUser('delete-admin1');
      const admin2 = await newUser('delete-admin2');
      const member = await newUser('delete-member');
      const teamId = await newTeam(admin1, [
        [admin2, 'admin'],
        [member, 'member'],
      ]);

      const byMember = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}`,
        headers: as(member),
      });
      expect(byMember.statusCode).toBe(403);

      // Удаляет не создатель, а второй администратор — оба равны в правах
      const byAdmin2 = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}`,
        headers: as(admin2),
      });
      expect(byAdmin2.statusCode).toBe(204);

      const after = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(admin1),
      });
      expect(after.statusCode).toBe(404);
    });

    it('комнаты команды переживают её удаление и остаются без команды', async () => {
      const admin = await newUser('rooms-admin');
      const teamId = await newTeam(admin);
      const roomId = randomUUID();
      roomIds.push(roomId);
      await db
        .insert(schema.rooms)
        .values({ id: roomId, teamId, creatorId: admin.id, name: 'Комната команды' });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}`,
        headers: as(admin),
      });
      expect(res.statusCode).toBe(204);

      const [room] = await db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId));
      expect(room?.teamId).toBeNull();
    });
  });

  describe('приглашения', () => {
    async function inviteCodeOf(teamId: string, admin: AuthUser): Promise<string> {
      const res = await app.inject({
        method: 'GET',
        url: `/api/teams/${teamId}`,
        headers: as(admin),
      });
      return (res.json() as { inviteCode: string }).inviteCode;
    }

    it('по ссылке видно название команды без входа, а вступление требует входа', async () => {
      const admin = await newUser('invite-admin');
      const teamId = await newTeam(admin);
      const code = await inviteCodeOf(teamId, admin);

      const preview = await app.inject({ method: 'GET', url: `/api/invites/${code}` });
      const joinAnon = await app.inject({ method: 'POST', url: `/api/invites/${code}/join` });

      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({ team: { id: teamId } });
      // В предпросмотре не должно быть состава команды
      expect(preview.body).not.toMatch(/members/);
      expect(joinAnon.statusCode).toBe(401);
    });

    it('вступивший получает роль участника, повторный переход ничего не меняет', async () => {
      const admin = await newUser('join-admin');
      const guest = await newUser('join-guest');
      const teamId = await newTeam(admin);
      const code = await inviteCodeOf(teamId, admin);

      const first = await app.inject({
        method: 'POST',
        url: `/api/invites/${code}/join`,
        headers: as(guest),
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ role: 'member' });

      // Повысили роль — повторный переход по ссылке не должен её сбросить
      await service.changeMemberRole(admin.id, teamId, guest.id, 'admin');
      const second = await app.inject({
        method: 'POST',
        url: `/api/invites/${code}/join`,
        headers: as(guest),
      });

      expect(second.json()).toMatchObject({ role: 'admin' });
    });

    it('перевыпуск кода доступен администратору и ломает старую ссылку', async () => {
      const admin1 = await newUser('rotate-admin1');
      const admin2 = await newUser('rotate-admin2');
      const member = await newUser('rotate-member');
      const teamId = await newTeam(admin1, [
        [admin2, 'admin'],
        [member, 'member'],
      ]);
      const oldCode = await inviteCodeOf(teamId, admin1);

      const byMember = await app.inject({
        method: 'POST',
        url: `/api/teams/${teamId}/invite/rotate`,
        headers: as(member),
      });
      expect(byMember.statusCode).toBe(403);

      const byAdmin2 = await app.inject({
        method: 'POST',
        url: `/api/teams/${teamId}/invite/rotate`,
        headers: as(admin2),
      });
      expect(byAdmin2.statusCode).toBe(200);
      const newCode = (byAdmin2.json() as { inviteCode: string }).inviteCode;
      expect(newCode).not.toBe(oldCode);

      const old = await app.inject({ method: 'GET', url: `/api/invites/${oldCode}` });
      expect(old.statusCode).toBe(404);
    });

    it('вступление с кукой удалённого пользователя отклоняется, а не ломает сервер', async () => {
      const admin = await newUser('ghost-admin');
      const ghost = await newUser('ghost');
      const teamId = await newTeam(admin);
      const code = await inviteCodeOf(teamId, admin);
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
    it('любой администратор может менять роли участников, участник — нет', async () => {
      const admin1 = await newUser('role-admin1');
      const admin2 = await newUser('role-admin2');
      const member = await newUser('role-member');
      const teamId = await newTeam(admin1, [
        [admin2, 'admin'],
        [member, 'member'],
      ]);

      const byMember = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${member.id}`,
        headers: as(member),
        payload: { role: 'admin' },
      });
      expect(byMember.statusCode).toBe(403);

      // Роль меняет не создатель, а второй администратор — оба равны в правах
      const byAdmin2 = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${member.id}`,
        headers: as(admin2),
        payload: { role: 'guest' },
      });
      expect(byAdmin2.statusCode).toBe(200);
      expect(byAdmin2.json()).toMatchObject({ member: { role: 'guest' } });
    });

    it('единственный администратор не может понизить сам себя', async () => {
      const admin = await newUser('demote-admin');
      const teamId = await newTeam(admin);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${admin.id}`,
        headers: as(admin),
        payload: { role: 'member' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('администратор может понизить себя, если в команде есть другой администратор', async () => {
      const admin1 = await newUser('self-demote-admin1');
      const admin2 = await newUser('self-demote-admin2');
      const teamId = await newTeam(admin1, [[admin2, 'admin']]);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${admin1.id}`,
        headers: as(admin1),
        payload: { role: 'member' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ actorRole: 'member' });
      expect(await adminCount(teamId)).toBe(1);
    });

    it('неизвестная роль отклоняется валидацией', async () => {
      const admin = await newUser('badrole-admin');
      const teamId = await newTeam(admin);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${admin.id}`,
        headers: as(admin),
        payload: { role: 'король' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('роль owner упразднена и отклоняется валидацией', async () => {
      const admin = await newUser('noowner-admin');
      const member = await newUser('noowner-member');
      const teamId = await newTeam(admin, [[member, 'member']]);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${member.id}`,
        headers: as(admin),
        payload: { role: 'owner' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('одновременные запросы', () => {
    it(
      'одновременное самопонижение администратора и выход второго администратора ' +
        'не оставляют команду без администратора',
      async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const admin1 = await newUser(`race-admin1-${attempt}`);
          const admin2 = await newUser(`race-admin2-${attempt}`);
          const teamId = await newTeam(admin1, [[admin2, 'admin']]);

          const [demote, leave] = await Promise.all([
            app.inject({
              method: 'PATCH',
              url: `/api/teams/${teamId}/members/${admin1.id}`,
              headers: as(admin1),
              payload: { role: 'member' },
            }),
            app.inject({
              method: 'DELETE',
              url: `/api/teams/${teamId}/members/${admin2.id}`,
              headers: as(admin2),
            }),
          ]);

          expect(demote.statusCode).toBeLessThan(500);
          expect(leave.statusCode).toBeLessThan(500);
          expect(
            await adminCount(teamId),
            'команда осталась без администратора',
          ).toBeGreaterThanOrEqual(1);
        }
      },
    );

    it('два администратора не могут одновременно оба выйти из команды', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const admin1 = await newUser(`race2-admin1-${attempt}`);
        const admin2 = await newUser(`race2-admin2-${attempt}`);
        const teamId = await newTeam(admin1, [[admin2, 'admin']]);

        const results = await Promise.all([
          app.inject({
            method: 'DELETE',
            url: `/api/teams/${teamId}/members/${admin1.id}`,
            headers: as(admin1),
          }),
          app.inject({
            method: 'DELETE',
            url: `/api/teams/${teamId}/members/${admin2.id}`,
            headers: as(admin2),
          }),
        ]);

        // Успеть должен ровно один выход — второй оставил бы команду без администратора
        expect(results.map((res) => res.statusCode).sort()).toEqual([204, 409]);
        expect(await adminCount(teamId), 'команда осталась без администратора').toBe(1);
      }
    });
  });

  describe('исключение и выход', () => {
    it('исключать участников может любой администратор', async () => {
      const admin1 = await newUser('kick-admin1');
      const admin2 = await newUser('kick-admin2');
      const member = await newUser('kick-member');
      const teamId = await newTeam(admin1, [
        [admin2, 'admin'],
        [member, 'member'],
      ]);

      // Исключает не создатель, а второй администратор — оба равны в правах
      const byAdmin2 = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${member.id}`,
        headers: as(admin2),
      });

      expect(byAdmin2.statusCode).toBe(204);
    });

    it('гость может выйти из команды сам', async () => {
      const admin = await newUser('guest-leave-admin');
      const guest = await newUser('guest-leave');
      const teamId = await newTeam(admin, [[guest, 'guest']]);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${guest.id}`,
        headers: as(guest),
      });

      expect(res.statusCode).toBe(204);
    });

    it('участник не может исключить другого участника, но может выйти сам', async () => {
      const admin = await newUser('leave-admin');
      const member = await newUser('leave-member');
      const other = await newUser('leave-other');
      const teamId = await newTeam(admin, [
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

    it('единственный администратор не может выйти из команды', async () => {
      const admin = await newUser('solo-admin');
      const member = await newUser('solo-member');
      const teamId = await newTeam(admin, [[member, 'member']]);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${admin.id}`,
        headers: as(admin),
      });

      expect(res.statusCode).toBe(409);
    });

    it('администратор может выйти, если в команде есть другой администратор', async () => {
      const admin1 = await newUser('leave-two-admin1');
      const admin2 = await newUser('leave-two-admin2');
      const teamId = await newTeam(admin1, [[admin2, 'admin']]);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${admin1.id}`,
        headers: as(admin1),
      });

      expect(res.statusCode).toBe(204);
      expect(await adminCount(teamId)).toBe(1);
    });

    it('смена роли того, кто не состоит в команде, даёт 404', async () => {
      const admin = await newUser('role-missing-admin');
      const stranger = await newUser('role-missing-stranger');
      const teamId = await newTeam(admin);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/teams/${teamId}/members/${stranger.id}`,
        headers: as(admin),
        payload: { role: 'admin' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('исключение того, кто не состоит в команде, даёт 404', async () => {
      const admin = await newUser('missing-admin');
      const stranger = await newUser('missing-stranger');
      const teamId = await newTeam(admin);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/teams/${teamId}/members/${stranger.id}`,
        headers: as(admin),
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
