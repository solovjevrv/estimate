import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AuthConfig } from '../config';
import { DOCS_TAGS, errorResponse } from '../http/openapi';
import { archivedQuerySchema, idParamsSchema } from '../http/schemas';
import type { ObjectStorage } from '../platform/storage';

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
  const controller = new BoardsController(
    BoardsService.forDatabase(app.db, opts.auth.guestSecret, images, app.log),
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
        summary: 'Мои личные доски',
        description:
          'Личные доски текущего пользователя (без командных). По умолчанию без архивных; ' +
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
  name: 'poker-boards',
  dependencies: ['poker-auth'],
});
