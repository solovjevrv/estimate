import { ROOM_NAME_MAX_LENGTH } from '@poker/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AuthConfig } from '../config';
import { DOCS_TAGS, errorResponse } from '../http/openapi';

import type { ArchivedQuery, CreateRoomBody, RoomIdParams, TeamIdParams } from './rooms.controller';
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
    revision: { type: 'integer' },
    createdAt: { type: 'string' },
    archivedAt: { type: ['string', 'null'] },
  },
} as const;

const roomsResponse = {
  type: 'object',
  properties: { rooms: { type: 'array', items: roomResponse } },
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

  // Секрет тот же, что и у сессии: гостевые токены выдаёт только сервер
  const controller = new RoomsController(RoomsService.forDatabase(app.db, opts.auth.jwtSecret));

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
