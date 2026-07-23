import { TEAM_ROLES } from '@poker/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type {
  InviteParams,
  MemberParams,
  NameBody,
  RoleBody,
  TeamIdParams,
} from './teams.controller';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

const uuid = { type: 'string', format: 'uuid' } as const;

const teamIdParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;

const memberParams = {
  type: 'object',
  required: ['id', 'userId'],
  properties: { id: uuid, userId: uuid },
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
    // Здесь только защита от гигантских тел; настоящий предел длины
    // проверяет сервис уже после обрезки пробелов
    name: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

const roleBody = {
  type: 'object',
  required: ['role'],
  properties: { role: { type: 'string', enum: [...TEAM_ROLES] } },
} as const;

// Схемы ответов задают и контракт, и фильтр сериализации: лишние поля
// (например, код приглашения) не смогут утечь при будущих правках.
const teamResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    createdAt: { type: 'string' },
  },
} as const;

const teamWithRoleResponse = {
  type: 'object',
  properties: { ...teamResponse.properties, role: { type: 'string' } },
} as const;

const memberResponse = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
    avatarUrl: { type: ['string', 'null'] },
    role: { type: 'string' },
    joinedAt: { type: 'string' },
  },
} as const;

const membersResponse = {
  type: 'object',
  properties: { members: { type: 'array', items: memberResponse } },
} as const;

async function teamsPluginImpl(app: FastifyInstance): Promise<void> {
  const authenticate = app.authenticate;
  if (!authenticate) {
    throw new Error('Роуты команд требуют плагина аутентификации');
  }

  const controller = new TeamsController(TeamsService.forDatabase(app.db));

  app.post<{ Body: NameBody }>(
    '/api/teams',
    {
      preHandler: authenticate,
      schema: {
        body: nameBody,
        response: {
          201: { type: 'object', properties: { team: teamWithRoleResponse } },
        },
      },
    },
    controller.create,
  );

  app.get(
    '/api/teams',
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { teams: { type: 'array', items: teamWithRoleResponse } },
          },
        },
      },
    },
    controller.list,
  );

  app.get<{ Params: TeamIdParams }>(
    '/api/teams/:id',
    {
      preHandler: authenticate,
      schema: {
        params: teamIdParams,
        response: {
          200: {
            type: 'object',
            properties: {
              team: teamResponse,
              role: { type: 'string' },
              members: { type: 'array', items: memberResponse },
              inviteCode: { type: 'string' },
            },
          },
        },
      },
    },
    controller.overview,
  );

  app.patch<{ Params: TeamIdParams; Body: NameBody }>(
    '/api/teams/:id',
    {
      preHandler: authenticate,
      schema: {
        params: teamIdParams,
        body: nameBody,
        response: { 200: { type: 'object', properties: { team: teamResponse } } },
      },
    },
    controller.rename,
  );

  app.delete<{ Params: TeamIdParams }>(
    '/api/teams/:id',
    { preHandler: authenticate, schema: { params: teamIdParams } },
    controller.remove,
  );

  app.get<{ Params: TeamIdParams }>(
    '/api/teams/:id/members',
    {
      preHandler: authenticate,
      schema: { params: teamIdParams, response: { 200: membersResponse } },
    },
    controller.members,
  );

  app.patch<{ Params: MemberParams; Body: RoleBody }>(
    '/api/teams/:id/members/:userId',
    {
      preHandler: authenticate,
      schema: {
        params: memberParams,
        body: roleBody,
        response: {
          200: {
            type: 'object',
            properties: {
              member: {
                type: 'object',
                properties: {
                  teamId: { type: 'string' },
                  userId: { type: 'string' },
                  role: { type: 'string' },
                },
              },
              actorRole: { type: 'string' },
            },
          },
        },
      },
    },
    controller.changeMemberRole,
  );

  app.delete<{ Params: MemberParams }>(
    '/api/teams/:id/members/:userId',
    { preHandler: authenticate, schema: { params: memberParams } },
    controller.removeMember,
  );

  app.post<{ Params: TeamIdParams }>(
    '/api/teams/:id/invite/rotate',
    {
      preHandler: authenticate,
      schema: {
        params: teamIdParams,
        response: { 200: { type: 'object', properties: { inviteCode: { type: 'string' } } } },
      },
    },
    controller.rotateInvite,
  );

  // Предпросмотр приглашения открыт без входа: по ссылке человек должен понять,
  // куда его зовут, ещё до авторизации. Секрет здесь — сам код.
  app.get<{ Params: InviteParams }>(
    '/api/invites/:code',
    {
      schema: {
        params: inviteParams,
        response: {
          200: {
            type: 'object',
            properties: {
              team: {
                type: 'object',
                properties: { id: { type: 'string' }, name: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    controller.previewInvite,
  );

  app.post<{ Params: InviteParams }>(
    '/api/invites/:code/join',
    {
      preHandler: authenticate,
      schema: {
        params: inviteParams,
        response: {
          200: { type: 'object', properties: { team: teamResponse, role: { type: 'string' } } },
        },
      },
    },
    controller.joinByInvite,
  );
}

export const teamsPlugin = fp(teamsPluginImpl, {
  name: 'poker-teams',
  dependencies: ['poker-auth'],
});
