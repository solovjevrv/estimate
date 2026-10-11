import { BOARD_ESTIMATE_MAX_ITEMS, BOARD_WS_SERVER_EVENTS } from '@estimate/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AuthConfig } from '../config';
import { DOCS_TAGS, errorResponse } from '../http/openapi';
import { archivedQuerySchema, idParamsSchema, moveTeamBodySchema } from '../http/schemas';
import type { ObjectStorage } from '../platform/storage';

import { BoardEstimatesService } from './board-estimates.service';
import { BoardImagesService } from './board-images.service';
import {
  boardResponse,
  boardSnapshotResponse,
  boardsResponse,
  createBoardBody,
  shareBody,
  titleBody,
} from './boards.schemas';
import type {
  ArchivedQuery,
  BoardIdParams,
  CreateBoardBody,
  EstimateRoomsBody,
  MoveBody,
  ShareBody,
  TeamIdParams,
  TitleBody,
} from './boards.controller';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

export interface BoardsPluginOptions {
  /** Не задан — доска без ObjectStorage: чистка файлов картинок при удалении отключена */
  objectStorage?: ObjectStorage;
  /** Легаси-каталог картинок для переходного чтения (Epic 21) */
  legacyAssetsDir?: string;
  auth: AuthConfig;
}

async function boardsPluginImpl(app: FastifyInstance, opts: BoardsPluginOptions): Promise<void> {
  const authenticate = app.authenticate;
  if (!authenticate) {
    throw new Error('Роуты досок требуют плагина аутентификации');
  }

  const images = opts.objectStorage
    ? BoardImagesService.create(opts.objectStorage, opts.legacyAssetsDir)
    : undefined;
  const boards = BoardsService.forDatabase(app.db, opts.auth.guestSecret, images, app.log);
  const controller = new BoardsController(
    boards,
    new BoardEstimatesService(app.db, boards),
    (boardId, updates) => {
      // Socket.io подключается после сборки приложения; в тестах REST его может не быть
      if (!app.hasDecorator('io')) return;
      for (const update of updates)
        app.io.to(boardId).emit(BOARD_WS_SERVER_EVENTS.ESTIMATE, update);
    },
    (boardId) => {
      if (!app.hasDecorator('io')) return;
      // Все выходят из канала доски — дальше рассылки получат только те, кто
      // заново прошёл JOIN с проверкой доступа (клиент перезаходит по событию)
      app.io.to(boardId).emit(BOARD_WS_SERVER_EVENTS.ACCESS, {});
      app.io.in(boardId).socketsLeave(boardId);
    },
  );

  app.patch<{ Params: BoardIdParams; Body: MoveBody }>(
    '/api/boards/:id/team',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Перенести доску',
        description:
          'Личная ↔ командная или в другую команду (10.24). Переносит владелец или админ ' +
          'команды; в команду — её участник (как при создании). `teamId: null` — личная у ' +
          'владельца. Комнаты оценки доски (15.6) переезжают вместе с ней — `movedRooms`.',
        security: [{ session: [] }],
        params: idParamsSchema,
        body: moveTeamBodySchema,
        response: {
          200: {
            description: 'Доска перенесена',
            type: 'object',
            properties: { board: boardResponse, movedRooms: { type: 'integer' } },
          },
          400: { description: 'Некорректная команда', ...errorResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Нет прав на перенос', ...errorResponse },
          404: { description: 'Доска или команда не найдена', ...errorResponse },
          409: { description: 'Уже там или некому отдать', ...errorResponse },
        },
      },
    },
    controller.move,
  );

  app.get<{ Params: BoardIdParams }>(
    '/api/boards/:id/estimate-rooms',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Число комнат оценки доски',
        description:
          'Сколько комнат оценки заведено со стикеров доски (15.6) — для окна переноса ' +
          '(10.24): они переедут вместе с доской. Видит тот, кто управляет доской.',
        security: [{ session: [] }],
        params: idParamsSchema,
        response: {
          200: {
            description: 'Число комнат',
            type: 'object',
            properties: { count: { type: 'integer' } },
          },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Доска не найдена', ...errorResponse },
        },
      },
    },
    controller.estimateRoomCount,
  );

  app.post<{ Params: BoardIdParams; Body: EstimateRoomsBody }>(
    '/api/boards/:id/estimate-rooms',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Отправить элементы доски в покер',
        description:
          'По комнате оценки на каждый стикер, название — текст ' +
          'стикера (15.6). Для стикера, у которого комната уже есть, отдаётся она ' +
          '(`created: false`) — повторы и двойные клики не плодят дублей. Нужен доступ ' +
          'на правку активной доски; комната командная, если доска командная.',
        security: [{ session: [] }],
        params: idParamsSchema,
        body: {
          type: 'object',
          required: ['itemIds'],
          additionalProperties: false,
          properties: {
            itemIds: {
              type: 'array',
              minItems: 1,
              maxItems: BOARD_ESTIMATE_MAX_ITEMS,
              items: { type: 'string', format: 'uuid' },
            },
          },
        },
        response: {
          200: {
            description: 'Комнаты элементов',
            type: 'object',
            properties: {
              rooms: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    itemId: { type: 'string' },
                    roomId: { type: 'string' },
                    created: { type: 'boolean' },
                  },
                },
              },
            },
          },
          400: { description: 'Нет подходящих элементов', ...errorResponse },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Нет права правки доски', ...errorResponse },
          404: { description: 'Доска не найдена', ...errorResponse },
          409: { description: 'Доска в архиве', ...errorResponse },
        },
      },
    },
    controller.estimateRooms,
  );

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
        summary: 'Доступные мне доски',
        description:
          'Личные доски пользователя и доски команд, где он состоит. По умолчанию без архивных; ' +
          '`archived=true` — только архивные.',
        security: [{ session: [] }],
        querystring: archivedQuerySchema,
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
        params: idParamsSchema,
        querystring: archivedQuerySchema,
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
      preHandler: app.identify,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Снимок доски',
        description:
          'Доска целиком: метаданные, элементы и связи. Личная — только владельцу, ' +
          'командная — любому участнику команды, включая гостя. Гость по ' +
          'включённой ссылке (14.4) видит снимок без входа.',
        params: idParamsSchema,
        response: {
          200: { description: 'Доска', ...boardSnapshotResponse },
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
        params: idParamsSchema,
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

  app.patch<{ Params: BoardIdParams; Body: ShareBody }>(
    '/api/boards/:id/share',
    {
      preHandler: authenticate,
      schema: {
        tags: [DOCS_TAGS.boards],
        summary: 'Настроить ссылку доступа к доске',
        description:
          'Доступно автору доски или администратору команды. ' +
          'role: "view" | "edit" | null (null — выключить шаринг).',
        security: [{ session: [] }],
        params: idParamsSchema,
        body: shareBody,
        response: {
          200: {
            description: 'Доска обновлена',
            type: 'object',
            properties: { board: boardResponse },
          },
          401: { description: 'Требуется вход', ...errorResponse },
          403: { description: 'Недостаточно прав', ...errorResponse },
          404: { description: 'Доска не найдена', ...errorResponse },
        },
      },
    },
    controller.setShare,
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
        params: idParamsSchema,
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
        params: idParamsSchema,
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
        params: idParamsSchema,
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
  name: 'estimate-boards',
  dependencies: ['estimate-auth'],
});
