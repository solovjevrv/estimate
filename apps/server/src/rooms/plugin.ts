import { ROOM_NAME_MAX_LENGTH } from '@poker/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { DOCS_TAGS, errorResponse } from '../http/openapi';

import type { CreateRoomBody, RoomIdParams, TeamIdParams } from './rooms.controller';
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

const roomResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    teamId: { type: ['string', 'null'] },
    creatorId: { type: ['string', 'null'] },
    name: { type: 'string' },
    status: { type: 'string' },
    createdAt: { type: 'string' },
  },
} as const;

const roomsResponse = {
  type: 'object',
  properties: { rooms: { type: 'array', items: roomResponse } },
} as const;

async function roomsPluginImpl(app: FastifyInstance): Promise<void> {
  const authenticate = app.authenticate;
  if (!authenticate) {
    throw new Error('Роуты комнат требуют плагина аутентификации');
  }

  const controller = new RoomsController(RoomsService.forDatabase(app.db));

  app.post<{ Body: CreateRoomBody }>(
    '/api/rooms',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Создать комнату',
        description:
          'Создатель становится скрам-мастером. Комнату можно завести и без команды — ' +
          'тогда в неё пускают по прямой ссылке. Комнату от лица команды создают её ' +
          'администратор и владелец.',
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

  app.get(
    '/api/rooms',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Мои комнаты без команды',
        security: [{ session: [] }],
        response: {
          200: { description: 'Список комнат', ...roomsResponse },
          401: { description: 'Требуется вход', ...errorResponse },
        },
      },
    },
    controller.listMine,
  );

  app.get<{ Params: TeamIdParams }>(
    '/api/teams/:id/rooms',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Комнаты команды',
        description: 'Доступно любому участнику команды.',
        security: [{ session: [] }],
        params: idParams,
        response: {
          200: { description: 'Список комнат', ...roomsResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          404: { description: 'Команда не найдена или вы не в ней', ...errorResponse },
        },
      },
    },
    controller.listByTeam,
  );

  app.post<{ Params: RoomIdParams }>(
    '/api/rooms/:id/close',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.rooms],
        summary: 'Закрыть комнату',
        description:
          'Доступно скрам-мастеру. В закрытой комнате нельзя голосовать и начинать раунды.',
        security: [{ session: [] }],
        params: idParams,
        response: {
          200: {
            description: 'Комната закрыта',
            type: 'object',
            properties: { room: roomResponse },
          },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Нужны права скрам-мастера', ...errorResponse },
          404: { description: 'Комната не найдена', ...errorResponse },
        },
      },
    },
    controller.close,
  );
}

export const roomsPlugin = fp(roomsPluginImpl, {
  name: 'poker-rooms',
  dependencies: ['poker-auth'],
});
