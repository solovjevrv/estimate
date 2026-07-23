import {
  TEAM_NAME_MAX_LENGTH,
  TEAM_NAME_MIN_LENGTH,
  TEAM_ROLES,
  type TeamRole,
  hasTeamRole,
} from '@poker/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import {
  type Membership,
  addMemberIfAbsent,
  countOwners,
  createTeam,
  deleteTeam,
  findInviteCode,
  findMembership,
  findTeam,
  findTeamByInviteCode,
  listMembers,
  listTeamsForUser,
  removeMember,
  renameTeam,
  rotateInviteCode,
  setMemberRole,
} from './repository';

declare module 'fastify' {
  interface FastifyRequest {
    /** Заполняется guard'ом requireRole: членство текущего пользователя в команде из URL */
    teamMembership?: Membership;
  }
}

const uuidSchema = { type: 'string', format: 'uuid' } as const;

const teamIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: uuidSchema },
} as const;

const memberParams = {
  type: 'object',
  required: ['id', 'userId'],
  properties: { id: uuidSchema, userId: uuidSchema },
} as const;

const inviteParams = {
  type: 'object',
  required: ['code'],
  properties: { code: { type: 'string', pattern: '^[A-Za-z0-9_-]{6,64}$' } },
} as const;

const nameBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: TEAM_NAME_MIN_LENGTH, maxLength: TEAM_NAME_MAX_LENGTH },
  },
} as const;

const roleBody = {
  type: 'object',
  required: ['role'],
  properties: { role: { type: 'string', enum: [...TEAM_ROLES] } },
} as const;

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'not_found', message: 'Команда не найдена' });
}

function forbidden(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(403).send({ error: 'forbidden', message });
}

function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(409).send({ error: 'conflict', message });
}

/** Название приходит от человека: убираем случайные пробелы по краям */
function normalizeName(value: string): string {
  return value.trim();
}

async function teamsPluginImpl(app: FastifyInstance): Promise<void> {
  const authenticate = app.authenticate;
  if (!authenticate) {
    throw new Error('Роуты команд требуют плагина аутентификации');
  }

  /**
   * Проверяет, что пользователь состоит в команде и его роль не ниже требуемой.
   * Чужим и несуществующим командам одинаково отвечаем 404 — чтобы по кодам
   * ответа нельзя было перебирать существующие команды.
   */
  function requireRole(required: TeamRole) {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { id } = req.params as { id: string };
      const membership = await findMembership(app.db, id, req.user.sub);
      if (!membership) {
        return void notFound(reply);
      }
      req.teamMembership = membership;
      if (!hasTeamRole(membership.role, required)) {
        return void forbidden(reply, 'Недостаточно прав в команде');
      }
    };
  }

  app.post(
    '/api/teams',
    { preHandler: authenticate, schema: { body: nameBody } },
    async (req, reply) => {
      const { name } = req.body as { name: string };
      const normalized = normalizeName(name);
      if (!normalized) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'Название не может быть пустым' });
      }

      const team = await createTeam(app.db, normalized, req.user.sub);
      return reply.code(201).send({ team });
    },
  );

  app.get('/api/teams', { preHandler: authenticate }, async (req) => ({
    teams: await listTeamsForUser(app.db, req.user.sub),
  }));

  app.get(
    '/api/teams/:id',
    { preHandler: [authenticate, requireRole('guest')], schema: { params: teamIdParams } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const team = await findTeam(app.db, id);
      if (!team) {
        return notFound(reply);
      }
      const membership = req.teamMembership as Membership;
      // Ссылка-приглашение — секрет: показываем её только тем, кто может звать
      const inviteCode = hasTeamRole(membership.role, 'admin')
        ? await findInviteCode(app.db, id)
        : undefined;

      return {
        team,
        role: membership.role,
        members: await listMembers(app.db, id),
        ...(inviteCode ? { inviteCode } : {}),
      };
    },
  );

  app.patch(
    '/api/teams/:id',
    {
      preHandler: [authenticate, requireRole('owner')],
      schema: { params: teamIdParams, body: nameBody },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const normalized = normalizeName((req.body as { name: string }).name);
      if (!normalized) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'Название не может быть пустым' });
      }

      const team = await renameTeam(app.db, id, normalized);
      return team ? { team } : notFound(reply);
    },
  );

  app.delete(
    '/api/teams/:id',
    { preHandler: [authenticate, requireRole('owner')], schema: { params: teamIdParams } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await deleteTeam(app.db, id);
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/teams/:id/members',
    { preHandler: [authenticate, requireRole('guest')], schema: { params: teamIdParams } },
    async (req) => {
      const { id } = req.params as { id: string };
      return { members: await listMembers(app.db, id) };
    },
  );

  app.patch(
    '/api/teams/:id/members/:userId',
    {
      preHandler: [authenticate, requireRole('owner')],
      schema: { params: memberParams, body: roleBody },
    },
    async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      const { role } = req.body as { role: TeamRole };

      const target = await findMembership(app.db, id, userId);
      if (!target) {
        return reply.code(404).send({ error: 'not_found', message: 'Участник не найден' });
      }
      if (target.role === role) {
        return { member: target };
      }
      if (userId === req.user.sub && role !== 'owner') {
        // Единственный владелец не может понизить себя: команда осталась бы без хозяина
        return conflict(reply, 'Сначала передайте владение другому участнику');
      }

      await setMemberRole(app.db, id, userId, role, req.user.sub);
      return { member: { teamId: id, userId, role } };
    },
  );

  app.delete(
    '/api/teams/:id/members/:userId',
    { preHandler: [authenticate, requireRole('guest')], schema: { params: memberParams } },
    async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      const actor = req.teamMembership as Membership;

      const target = await findMembership(app.db, id, userId);
      if (!target) {
        return reply.code(404).send({ error: 'not_found', message: 'Участник не найден' });
      }

      if (userId === actor.userId) {
        // Выйти может каждый, но владелец — только передав команду
        if (actor.role === 'owner' && (await countOwners(app.db, id)) === 1) {
          return conflict(reply, 'Передайте владение или удалите команду');
        }
      } else {
        if (!hasTeamRole(actor.role, 'admin')) {
          return forbidden(reply, 'Исключать участников могут владелец и администратор');
        }
        if (actor.role === 'admin' && hasTeamRole(target.role, 'admin')) {
          return forbidden(reply, 'Администратор не может исключить владельца или администратора');
        }
      }

      await removeMember(app.db, id, userId);
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/teams/:id/invite/rotate',
    { preHandler: [authenticate, requireRole('admin')], schema: { params: teamIdParams } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const inviteCode = await rotateInviteCode(app.db, id);
      return inviteCode ? { inviteCode } : notFound(reply);
    },
  );

  // Предпросмотр приглашения открыт без входа: по ссылке человек должен понять,
  // куда его зовут, ещё до авторизации. Секрет здесь — сам код.
  app.get('/api/invites/:code', { schema: { params: inviteParams } }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const team = await findTeamByInviteCode(app.db, code);
    if (!team) {
      return reply.code(404).send({ error: 'not_found', message: 'Приглашение не найдено' });
    }
    return { team: { id: team.id, name: team.name } };
  });

  app.post(
    '/api/invites/:code/join',
    { preHandler: authenticate, schema: { params: inviteParams } },
    async (req, reply) => {
      const { code } = req.params as { code: string };
      const team = await findTeamByInviteCode(app.db, code);
      if (!team) {
        return reply.code(404).send({ error: 'not_found', message: 'Приглашение не найдено' });
      }

      await addMemberIfAbsent(app.db, team.id, req.user.sub);
      const membership = await findMembership(app.db, team.id, req.user.sub);
      return { team, role: membership?.role ?? 'member' };
    },
  );
}

export const teamsPlugin = fp(teamsPluginImpl, {
  name: 'poker-teams',
  dependencies: ['poker-auth'],
});
