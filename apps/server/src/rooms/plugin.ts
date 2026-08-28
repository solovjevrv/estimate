import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { DOCS_TAGS, errorResponse } from '../http/openapi';
import { archivedQuerySchema, idParamsSchema } from '../http/schemas';

import type {
  ArchivedQuery,
  CreateRoomBody,
  NameBody,
  RoomIdParams,
  TeamIdParams,
} from './rooms.controller';
import { RoomsController } from './rooms.controller';
import {
  createRoomBody,
  nameBody,
  roomResponse,
  roomStatsResponse,
  roomsResponse,
  roundHistoryResponse,
} from './rooms.schemas';
import { RoomsService } from './rooms.service';

export interface RoomsRateLimitOptions {
  max: number;
  timeWindow: string;
}

export interface RoomsPluginOptions {
  /** Переопределение для интеграционных тестов, где один и тот же IP легитимно шлёт много запросов подряд */
  rateLimit?: RoomsRateLimitOptions;
}

/** Страховка от перебора и накрутки запросов к REST комнат (7.34) */
const ROOMS_RATE_LIMIT_MAX = 30;
const ROOMS_RATE_LIMIT_WINDOW = '1 minute';

async function roomsPluginImpl(app: FastifyInstance, opts: RoomsPluginOptions): Promise<void> {
  const authenticate = app.authenticate;
  if (!authenticate) {
    throw new Error('Роуты комнат требуют плагина аутентификации');
  }

  // Отдельный секрет гостевых токенов (выведен из jwtSecret) — их выдаёт только сервер
  const controller = new RoomsController(RoomsService.forDatabase(app.db));

  /**
   * Отдельный вложенный контекст (без fp): так у лимитера свои границы и он не
   * начинает считать заодно /api/me, /api/teams и остальной API (по образцу
   * /api/auth/* в auth/plugin.ts, 7.8).
   */
  await app.register(async (rooms) => {
    await rooms.register(fastifyRateLimit, {
      max: opts.rateLimit?.max ?? ROOMS_RATE_LIMIT_MAX,
      timeWindow: opts.rateLimit?.timeWindow ?? ROOMS_RATE_LIMIT_WINDOW,
      // Свой бюджет на каждый роут: иначе безобидный список комнат делил бы
      // лимит с созданием/удалением
      keyGenerator: (req) => `${req.ip}:${req.routeOptions.url ?? req.url}`,
      errorResponseBuilder: (_req, context) => {
        const err = new Error(`Слишком много запросов, повторите через ${context.after}`);
        (err as Error & { statusCode: number }).statusCode = context.statusCode;
        return err;
      },
    });

    rooms.post<{ Body: CreateRoomBody }>(
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

    rooms.get<{ Params: RoomIdParams }>(
      '/api/rooms/:id',
      {
        schema: {
          tags: [DOCS_TAGS.rooms],
          summary: 'Комната по ссылке',
          description: 'Открыта без входа: по прямой ссылке в комнату может зайти и гость.',
          params: idParamsSchema,
          response: {
            200: { description: 'Комната', type: 'object', properties: { room: roomResponse } },
            404: { description: 'Комната не найдена', ...errorResponse },
          },
        },
      },
      controller.get,
    );

    rooms.get<{ Params: RoomIdParams }>(
      '/api/rooms/:id/rounds',
      {
        schema: {
          tags: [DOCS_TAGS.rooms],
          summary: 'История раундов комнаты',
          description:
            'Вскрытые раунды комнаты с итогами, от последнего к первому. Открыта без входа — ' +
            'так же, как и сама комната.',
          params: idParamsSchema,
          response: {
            200: { description: 'История раундов', ...roundHistoryResponse },
            404: { description: 'Комната не найдена', ...errorResponse },
          },
        },
      },
      controller.history,
    );

    rooms.get<{ Querystring: ArchivedQuery }>(
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
          querystring: archivedQuerySchema,
          response: {
            200: { description: 'Список комнат', ...roomsResponse },
            401: { description: 'Требуется вход', ...errorResponse },
          },
        },
      },
      controller.listMine,
    );

    rooms.get(
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

    rooms.get<{ Params: TeamIdParams; Querystring: ArchivedQuery }>(
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
          params: idParamsSchema,
          querystring: archivedQuerySchema,
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

    rooms.post<{ Params: RoomIdParams }>(
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
          params: idParamsSchema,
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

    rooms.patch<{ Params: RoomIdParams; Body: NameBody }>(
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
          params: idParamsSchema,
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

    rooms.delete<{ Params: RoomIdParams }>(
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
          params: idParamsSchema,
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
  });
}

export const roomsPlugin = fp(roomsPluginImpl, {
  name: 'estimate-rooms',
  dependencies: ['estimate-auth'],
});
