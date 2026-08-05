import { TEAM_ROLES } from '@poker/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { DOCS_TAGS, errorResponse } from '../http/openapi';

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
  properties: {
    ...teamResponse.properties,
    role: { type: 'string' },
    memberCount: { type: 'number' },
  },
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

const memberProfileResponse = {
  type: 'object',
  properties: {
    ...memberResponse.properties,
    provider: { type: 'string' },
    jobTitle: { type: ['string', 'null'] },
  },
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
        tags: [DOCS_TAGS.teams],
        summary: 'Создать команду',
        description: 'Создатель сразу становится администратором.',
        security: [{ session: [] }],
        body: nameBody,
        response: {
          201: {
            description: 'Команда создана',
            type: 'object',
            properties: { team: teamWithRoleResponse },
          },
          400: { description: 'Название пустое или слишком длинное', ...errorResponse },
          401: { description: 'Требуется вход', ...errorResponse },
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
        tags: [DOCS_TAGS.teams],
        summary: 'Мои команды',
        description: 'Команды, в которых состоит текущий пользователь, вместе с его ролью.',
        security: [{ session: [] }],
        response: {
          200: {
            description: 'Список команд',
            type: 'object',
            properties: { teams: { type: 'array', items: teamWithRoleResponse } },
          },
          401: { description: 'Требуется вход', ...errorResponse },
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
        tags: [DOCS_TAGS.teams],
        summary: 'Карточка команды',
        description:
          'Состав, роль текущего пользователя и код приглашения (только для администратора). Посторонним отвечаем 404.',
        security: [{ session: [] }],
        params: teamIdParams,
        response: {
          200: {
            description: 'Команда и её состав',
            type: 'object',
            properties: {
              team: teamResponse,
              role: { type: 'string' },
              members: { type: 'array', items: memberResponse },
              inviteCode: { type: 'string' },
            },
          },
          401: { description: 'Требуется вход', ...errorResponse },
          404: { description: 'Команда не найдена или вы не в ней', ...errorResponse },
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
        tags: [DOCS_TAGS.teams],
        summary: 'Переименовать команду',
        description: 'Доступно администратору.',
        security: [{ session: [] }],
        params: teamIdParams,
        body: nameBody,
        response: {
          200: {
            description: 'Команда обновлена',
            type: 'object',
            properties: { team: teamResponse },
          },
          400: { description: 'Название пустое или слишком длинное', ...errorResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Команда не найдена', ...errorResponse },
        },
      },
    },
    controller.rename,
  );

  app.delete<{ Params: TeamIdParams }>(
    '/api/teams/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.teams],
        summary: 'Удалить команду',
        description: 'Доступно администратору. Комнаты команды сохраняются и остаются без команды.',
        security: [{ session: [] }],
        params: teamIdParams,
        response: {
          204: { description: 'Команда удалена', type: 'null' },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Команда не найдена', ...errorResponse },
        },
      },
    },
    controller.remove,
  );

  app.get<{ Params: TeamIdParams }>(
    '/api/teams/:id/members',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.teams],
        summary: 'Состав команды',
        description: 'Гостю команды адреса участников не показываются.',
        security: [{ session: [] }],
        params: teamIdParams,
        response: {
          200: { description: 'Участники', ...membersResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          404: { description: 'Команда не найдена или вы не в ней', ...errorResponse },
        },
      },
    },
    controller.members,
  );

  app.get<{ Params: MemberParams }>(
    '/api/teams/:id/members/:userId',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.teams],
        summary: 'Карточка участника',
        description:
          'Профиль одного участника команды: то же, что видно на "Мой профиль". Гостю команды email не показывается. Доступно только тем, кто сам состоит в команде.',
        security: [{ session: [] }],
        params: memberParams,
        response: {
          200: {
            description: 'Участник',
            type: 'object',
            properties: { member: memberProfileResponse },
          },
          401: { description: 'Требуется вход', ...errorResponse },
          404: {
            description: 'Команда, участник не найдены или вы не в команде',
            ...errorResponse,
          },
        },
      },
    },
    controller.member,
  );

  app.patch<{ Params: MemberParams; Body: RoleBody }>(
    '/api/teams/:id/members/:userId',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.teams],
        summary: 'Изменить роль участника',
        description: 'Доступно администратору. Администраторов в команде может быть несколько.',
        security: [{ session: [] }],
        params: memberParams,
        body: roleBody,
        response: {
          200: {
            description: 'Роль изменена',
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
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Команда или участник не найдены', ...errorResponse },
          409: {
            description: 'Единственный администратор не может понизить себя',
            ...errorResponse,
          },
        },
      },
    },
    controller.changeMemberRole,
  );

  app.delete<{ Params: MemberParams }>(
    '/api/teams/:id/members/:userId',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.teams],
        summary: 'Исключить участника или выйти',
        description:
          'Исключать может только администратор, выйти самому — любой участник. Единственному администратору нужно сначала назначить другого.',
        security: [{ session: [] }],
        params: memberParams,
        response: {
          204: { description: 'Участник исключён', type: 'null' },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Команда или участник не найдены', ...errorResponse },
          409: {
            description: 'Единственный администратор не может выйти, не назначив другого',
            ...errorResponse,
          },
        },
      },
    },
    controller.removeMember,
  );

  app.post<{ Params: TeamIdParams }>(
    '/api/teams/:id/invite/rotate',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.teams],
        summary: 'Перевыпустить код приглашения',
        description: 'Доступно администратору. Старая ссылка перестаёт работать.',
        security: [{ session: [] }],
        params: teamIdParams,
        response: {
          200: {
            description: 'Новый код',
            type: 'object',
            properties: { inviteCode: { type: 'string' } },
          },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Команда не найдена', ...errorResponse },
        },
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
        tags: [DOCS_TAGS.teams],
        summary: 'Предпросмотр приглашения',
        description: 'Открыт без входа: по ссылке видно, в какую команду зовут.',
        params: inviteParams,
        response: {
          200: {
            description: 'Команда по коду приглашения',
            type: 'object',
            properties: {
              team: {
                type: 'object',
                properties: { id: { type: 'string' }, name: { type: 'string' } },
              },
            },
          },
          404: { description: 'Приглашение не найдено', ...errorResponse },
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
        tags: [DOCS_TAGS.teams],
        summary: 'Вступить по приглашению',
        description: 'Идемпотентно: повторный переход не меняет уже выданную роль.',
        security: [{ session: [] }],
        params: inviteParams,
        response: {
          200: {
            description: 'Вы в команде',
            type: 'object',
            properties: { team: teamResponse, role: { type: 'string' } },
          },
          401: { description: 'Требуется вход', ...errorResponse },
          404: { description: 'Приглашение не найдено', ...errorResponse },
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
