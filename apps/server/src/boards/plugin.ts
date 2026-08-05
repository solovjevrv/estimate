import { BOARD_TITLE_MAX_LENGTH } from '@poker/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { DOCS_TAGS, errorResponse } from '../http/openapi';

import type {
  ArchivedQuery,
  BoardIdParams,
  CreateBoardBody,
  TeamIdParams,
  TitleBody,
} from './boards.controller';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

const uuid = { type: 'string', format: 'uuid' } as const;

const boardIdParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;
const teamIdParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;

const titleBody = {
  type: 'object',
  required: ['title'],
  properties: {
    // Настоящий предел длины проверяет сервис после обрезки пробелов
    title: { type: 'string', minLength: 1, maxLength: BOARD_TITLE_MAX_LENGTH + 100 },
  },
} as const;

const createBoardBody = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: BOARD_TITLE_MAX_LENGTH + 100 },
    teamId: { type: ['string', 'null'], format: 'uuid' },
  },
} as const;

// coerceTypes выключен глобально, поэтому булево из строки запроса не собрать
// схемой — принимаем строку 'true'/'false' и разбираем её в контроллере
const archivedQuery = {
  type: 'object',
  properties: { archived: { type: 'string', enum: ['true', 'false'] } },
} as const;

const boardResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    teamId: { type: ['string', 'null'] },
    ownerId: { type: ['string', 'null'] },
    title: { type: 'string' },
    status: { type: 'string' },
    revision: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

const boardSummaryResponse = {
  type: 'object',
  properties: { ...boardResponse.properties, itemCount: { type: 'integer' } },
} as const;

const boardsResponse = {
  type: 'object',
  properties: { boards: { type: 'array', items: boardSummaryResponse } },
} as const;

// content/style — jsonb: конкретная форма растёт по мере эпиков (12.6+), поэтому
// намеренно не сужаем до конкретных полей здесь, чтобы схема ответа не глотала
// новые ключи будущих типов элементов молча
const jsonbResponse = { type: 'object', additionalProperties: true } as const;

const boardItemResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    boardId: { type: 'string' },
    parentId: { type: ['string', 'null'] },
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    rotation: { type: 'number' },
    zIndex: { type: 'integer' },
    content: jsonbResponse,
    style: jsonbResponse,
    createdBy: { type: ['string', 'null'] },
    updatedAt: { type: 'string' },
  },
} as const;

const boardEdgeResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    boardId: { type: 'string' },
    sourceItemId: { type: 'string' },
    targetItemId: { type: 'string' },
    sourceHandle: { type: ['string', 'null'] },
    targetHandle: { type: ['string', 'null'] },
    label: { type: ['string', 'null'] },
    style: jsonbResponse,
  },
} as const;

const boardSnapshotResponse = {
  type: 'object',
  properties: {
    board: boardResponse,
    items: { type: 'array', items: boardItemResponse },
    edges: { type: 'array', items: boardEdgeResponse },
  },
} as const;

async function boardsPluginImpl(app: FastifyInstance): Promise<void> {
  const authenticate = app.authenticate;
  if (!authenticate) {
    throw new Error('Роуты досок требуют плагина аутентификации');
  }

  const controller = new BoardsController(BoardsService.forDatabase(app.db));

  app.post<{ Body: CreateBoardBody }>(
    '/api/boards',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Создать доску',
        description:
          'Без teamId (или с null) доска личная — доступна только создателю. С teamId ' +
          'доска командная: заводить может участник или администратор команды.',
        security: [{ session: [] }],
        body: createBoardBody,
        response: {
          201: {
            description: 'Доска создана',
            type: 'object',
            properties: { board: boardResponse },
          },
          400: { description: 'Некорректное название', ...errorResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Нет прав заводить доски команды', ...errorResponse },
          404: { description: 'Команда не найдена', ...errorResponse },
        },
      },
    },
    controller.create,
  );

  app.get<{ Querystring: ArchivedQuery }>(
    '/api/boards',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Мои личные доски',
        description:
          'Личные доски текущего пользователя (без командных). По умолчанию без архивных; ' +
          '`archived=true` — только архивные.',
        security: [{ session: [] }],
        querystring: archivedQuery,
        response: {
          200: { description: 'Список досок', ...boardsResponse },
          401: { description: 'Требуется вход', ...errorResponse },
        },
      },
    },
    controller.listMine,
  );

  app.get<{ Params: TeamIdParams; Querystring: ArchivedQuery }>(
    '/api/teams/:id/boards',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Доски команды',
        description:
          'Доступно любому участнику команды, включая гостя. По умолчанию без архивных; ' +
          '`archived=true` — только архивные.',
        security: [{ session: [] }],
        params: teamIdParams,
        querystring: archivedQuery,
        response: {
          200: { description: 'Список досок', ...boardsResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          404: { description: 'Команда не найдена или вы не в ней', ...errorResponse },
        },
      },
    },
    controller.listByTeam,
  );

  app.get<{ Params: BoardIdParams }>(
    '/api/boards/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Снимок доски',
        description:
          'Доска целиком: метаданные, элементы и связи. Личная — только владельцу, ' +
          'командная — любому участнику команды, включая гостя.',
        security: [{ session: [] }],
        params: boardIdParams,
        response: {
          200: { description: 'Доска', ...boardSnapshotResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          404: { description: 'Доска не найдена или у вас нет доступа', ...errorResponse },
        },
      },
    },
    controller.get,
  );

  app.patch<{ Params: BoardIdParams; Body: TitleBody }>(
    '/api/boards/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Переименовать доску',
        description: 'Доступно автору доски или администратору команды.',
        security: [{ session: [] }],
        params: boardIdParams,
        body: titleBody,
        response: {
          200: {
            description: 'Доска обновлена',
            type: 'object',
            properties: { board: boardResponse },
          },
          400: { description: 'Некорректное название', ...errorResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Доска не найдена', ...errorResponse },
        },
      },
    },
    controller.rename,
  );

  app.post<{ Params: BoardIdParams }>(
    '/api/boards/:id/archive',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Архивировать доску',
        description:
          'Доступно автору доски или администратору команды. Доска пропадает из основных ' +
          'списков, но остаётся доступна по прямой ссылке. Настоящее удаление — отдельным ' +
          'действием, только для уже заархивированной доски.',
        security: [{ session: [] }],
        params: boardIdParams,
        response: {
          200: {
            description: 'Доска заархивирована',
            type: 'object',
            properties: { board: boardResponse },
          },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Доска не найдена', ...errorResponse },
          409: { description: 'Доска уже в архиве', ...errorResponse },
        },
      },
    },
    controller.archive,
  );

  app.post<{ Params: BoardIdParams }>(
    '/api/boards/:id/unarchive',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Вернуть доску из архива',
        description: 'Доступно автору доски или администратору команды.',
        security: [{ session: [] }],
        params: boardIdParams,
        response: {
          200: {
            description: 'Доска возвращена из архива',
            type: 'object',
            properties: { board: boardResponse },
          },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Доска не найдена', ...errorResponse },
          409: { description: 'Доска не в архиве', ...errorResponse },
        },
      },
    },
    controller.unarchive,
  );

  app.delete<{ Params: BoardIdParams }>(
    '/api/boards/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Удалить доску навсегда',
        description:
          'Необратимо: удаляет все элементы и связи вместе с доской. Доступно только для уже ' +
          'заархивированной доски и только её автору или администратору команды.',
        security: [{ session: [] }],
        params: boardIdParams,
        response: {
          204: { description: 'Доска удалена', type: 'null' },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Доска не найдена', ...errorResponse },
          409: { description: 'Сначала заархивируйте доску', ...errorResponse },
        },
      },
    },
    controller.remove,
  );
}

export const boardsPlugin = fp(boardsPluginImpl, {
  name: 'poker-boards',
  dependencies: ['poker-auth'],
});
