import { ROOM_NAME_MAX_LENGTH } from '@poker/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AuthConfig } from '../config';
import { DOCS_TAGS, errorResponse } from '../http/openapi';

import type {
  ArchivedQuery,
  CreateRoomBody,
  NameBody,
  RoomIdParams,
  TeamIdParams,
} from './rooms.controller';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

const uuid = { type: 'string', format: 'uuid' } as const;

const idParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;

const createRoomBody = {
  type: 'object',
  required: ['name'],
  properties: {
    // Настоящий предел длины проверяет сервис после обрезки пробелов
    name: { type: 'string', minLength: 1, maxLength: ROOM_NAME_MAX_LENGTH + 100 },
    teamId: { type: ['string', 'null'], format: 'uuid' },
  },
} as const;

const nameBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: ROOM_NAME_MAX_LENGTH + 100 },
  },
} as const;

const roomResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    teamId: { type: ['string', 'null'] },
    creatorId: { type: ['string', 'null'] },
    name: { type: 'string' },
    status: { type: 'string' },
    revision: { type: 'integer' },
    createdAt: { type: 'string' },
    archivedAt: { type: ['string', 'null'] },
  },
} as const;

const roomsResponse = {
  type: 'object',
  properties: { rooms: { type: 'array', items: roomResponse } },
} as const;

const roomStatsResponse = {
  type: 'object',
  properties: {
    roundsPlayed: { type: 'integer' },
    tasksEstimated: { type: 'integer' },
    avgRoundDurationSec: { type: ['number', 'null'] },
  },
} as const;

const roundResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    roomId: { type: 'string' },
    seq: { type: 'integer' },
    deckType: { type: 'string' },
    status: { type: 'string' },
    average: { type: ['number', 'null'] },
    createdAt: { type: 'string' },
    revealedAt: { type: ['string', 'null'] },
  },
} as const;

const roundResultResponse = {
  type: 'object',
  properties: {
    average: { type: ['number', 'null'] },
    min: { type: 'number' },
    max: { type: 'number' },
    agreement: { type: 'number' },
    votes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          participantId: { type: 'string' },
          name: { type: 'string' },
          value: { type: 'number' },
        },
      },
    },
  },
} as const;

const roundHistoryResponse = {
  type: 'object',
  properties: {
    rounds: {
      type: 'array',
      items: {
        type: 'object',
        properties: { round: roundResponse, result: roundResultResponse },
      },
    },
  },
} as const;

// coerceTypes выключен глобально, поэтому булево из строки запроса не собрать
// схемой — принимаем строку 'true'/'false' и разбираем её в контроллере
const archivedQuery = {
  type: 'object',
  properties: { archived: { type: 'string', enum: ['true', 'false'] } },
} as const;

export interface RoomsPluginOptions {
  auth: AuthConfig;
}

async function roomsPluginImpl(app: FastifyInstance, opts: RoomsPluginOptions): Promise<void> {
  const authenticate = app.authenticate;
  if (!authenticate) {
    throw new Error('Роуты комнат требуют плагина аутентификации');
  }

  // Отдельный секрет гостевых токенов (выведен из jwtSecret) — их выдаёт только сервер
  const controller = new RoomsController(RoomsService.forDatabase(app.db, opts.auth.guestSecret));

  app.post<{ Body: CreateRoomBody }>(
    '/api/rooms',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Создать комнату',
        description:
          'Создатель становится скрам-мастером. Комнату можно завести и без команды — ' +
          'тогда в неё пускают по прямой ссылке. Комнату от лица команды создаёт её ' +
          'администратор.',
        security: [{ session: [] }],
        body: createRoomBody,
        response: {
          201: {
            description: 'Комната создана',
            type: 'object',
            properties: { room: roomResponse },
          },
          400: { description: 'Некорректное название', ...errorResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Нет прав создавать комнаты команды', ...errorResponse },
          404: { description: 'Команда не найдена', ...errorResponse },
        },
      },
    },
    controller.create,
  );

  app.get<{ Params: RoomIdParams }>(
    '/api/rooms/:id',
    {
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Комната по ссылке',
        description: 'Открыта без входа: по прямой ссылке в комнату может зайти и гость.',
        params: idParams,
        response: {
          200: { description: 'Комната', type: 'object', properties: { room: roomResponse } },
          404: { description: 'Комната не найдена', ...errorResponse },
        },
      },
    },
    controller.get,
  );

  app.get<{ Params: RoomIdParams }>(
    '/api/rooms/:id/rounds',
    {
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'История раундов комнаты',
        description:
          'Вскрытые раунды комнаты с итогами, от последнего к первому. Открыта без входа — ' +
          'так же, как и сама комната.',
        params: idParams,
        response: {
          200: { description: 'История раундов', ...roundHistoryResponse },
          404: { description: 'Комната не найдена', ...errorResponse },
        },
      },
    },
    controller.history,
  );

  app.get<{ Querystring: ArchivedQuery }>(
    '/api/rooms',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Мои комнаты',
        description:
          'Все комнаты, которые создал пользователь — личные и командные вместе. ' +
          'По умолчанию без архивных; `archived=true` — только архивные.',
        security: [{ session: [] }],
        querystring: archivedQuery,
        response: {
          200: { description: 'Список комнат', ...roomsResponse },
          401: { description: 'Требуется вход', ...errorResponse },
        },
      },
    },
    controller.listMine,
  );

  app.get(
    '/api/rooms/stats',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Статистика по своим комнатам',
        description:
          'Раундов сыграно, задач оценено (комнат хотя бы с одним вскрытым раундом) и ' +
          'среднее время раунда — по всем комнатам пользователя, архивным и активным вместе.',
        security: [{ session: [] }],
        response: {
          200: {
            description: 'Статистика',
            type: 'object',
            properties: { stats: roomStatsResponse },
          },
          401: { description: 'Требуется вход', ...errorResponse },
        },
      },
    },
    controller.stats,
  );

  app.get<{ Params: TeamIdParams; Querystring: ArchivedQuery }>(
    '/api/teams/:id/rooms',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Комнаты команды',
        description:
          'Обычный список доступен любому участнику команды. Архивный (`archived=true`) — ' +
          'только владельцу и администратору.',
        security: [{ session: [] }],
        params: idParams,
        querystring: archivedQuery,
        response: {
          200: { description: 'Список комнат', ...roomsResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          403: {
            description: 'Архив команды виден только владельцу и администратору',
            ...errorResponse,
          },
          404: { description: 'Команда не найдена или вы не в ней', ...errorResponse },
        },
      },
    },
    controller.listByTeam,
  );

  app.post<{ Params: RoomIdParams }>(
    '/api/rooms/:id/archive',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Архивировать комнату',
        description:
          'Доступно скрам-мастеру (создателю или админу/владельцу команды). Комната пропадает ' +
          'из основных списков, но остаётся открыта по прямой ссылке для чтения. Настоящее ' +
          'удаление — отдельным действием, только для уже заархивированной комнаты.',
        security: [{ session: [] }],
        params: idParams,
        response: {
          200: {
            description: 'Комната заархивирована',
            type: 'object',
            properties: { room: roomResponse },
          },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Нужны права скрам-мастера', ...errorResponse },
          404: { description: 'Комната не найдена', ...errorResponse },
          409: { description: 'Комната уже в архиве', ...errorResponse },
        },
      },
    },
    controller.archive,
  );

  app.patch<{ Params: RoomIdParams; Body: NameBody }>(
    '/api/rooms/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Переименовать комнату',
        description:
          'Доступно скрам-мастеру (создателю или админу/владельцу команды). Доступно и для ' +
          'уже заархивированной комнаты.',
        security: [{ session: [] }],
        params: idParams,
        body: nameBody,
        response: {
          200: {
            description: 'Комната переименована',
            type: 'object',
            properties: { room: roomResponse },
          },
          400: { description: 'Некорректное название', ...errorResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Нужны права скрам-мастера', ...errorResponse },
          404: { description: 'Комната не найдена', ...errorResponse },
        },
      },
    },
    controller.rename,
  );

  app.delete<{ Params: RoomIdParams }>(
    '/api/rooms/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Удалить комнату навсегда',
        description:
          'Необратимо: удаляет раунды и голоса вместе с комнатой. Доступно только для уже ' +
          'заархивированной комнаты и только скрам-мастеру.',
        security: [{ session: [] }],
        params: idParams,
        response: {
          204: { description: 'Комната удалена' },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Нужны права скрам-мастера', ...errorResponse },
          404: { description: 'Комната не найдена', ...errorResponse },
          409: { description: 'Сначала заархивируйте комнату', ...errorResponse },
        },
      },
    },
    controller.remove,
  );
}

export const roomsPlugin = fp(roomsPluginImpl, {
  name: 'poker-rooms',
  dependencies: ['poker-auth'],
});
