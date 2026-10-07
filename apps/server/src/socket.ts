import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';

import { BOARD_WS_SERVER_EVENTS } from '@estimate/shared';

import {
  BoardsGateway,
  BoardsService,
  type BoardEstimatesService,
  type BoardVotingService,
} from './boards';
import { RoomsGameService, RoomsGateway } from './rooms';

/** Данные, которые сервер держит на каждом подключении */
export interface SocketData {
  /** id авторизованного пользователя или null — тогда это гость */
  userId: string | null;
}

export type PokerServer = Server<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketData
>;

/**
 * Сокет с типизированным `data`. Шлюзы раньше принимали голый `Socket` из
 * socket.io — у него `data` имеет тип `any`, поэтому `socket.data.userId`
 * молча превращался в `any` и тёк дальше в вызовы сервисов.
 */
export type PokerSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketData
>;

declare module 'fastify' {
  interface FastifyInstance {
    io: PokerServer;
  }
}

export interface SocketGatewayOptions {
  /** Origin дев-фронта для CORS */
  corsOrigin: string;
  /** Голосование точками на досках (15.2); не задано — его события отклоняются */
  boardVoting?: BoardVotingService;
  /** Оценки элементов доски из покер-комнат (15.6); не задано — оценок нет */
  boardEstimates?: BoardEstimatesService;
}

/**
 * Socket.io поверх HTTP-сервера Fastify вместе с событиями игрового стола и
 * досок. Сервисы приходят готовыми снаружи (не строятся из `app.db` внутри
 * `attach()`), чтобы шлюзы можно было юнит-тестировать без реальной БД (7.31).
 */
export class SocketGateway {
  constructor(
    private readonly roomsService: RoomsGameService,
    private readonly boardsService: BoardsService,
    private readonly options: SocketGatewayOptions,
  ) {}

  attach(app: FastifyInstance): PokerServer {
    const io: PokerServer = new Server(app.server, {
      // credentials нужен, чтобы браузер слал cookie сессии на дев-фронт (другой origin)
      cors: { origin: this.options.corsOrigin, credentials: true },
    });

    io.use((socket, next) => {
      const session = this.identify(app, socket.handshake.headers.cookie);
      socket.data.userId = session?.userId ?? null;

      // Хендшейк проходит один раз на всё время жизни соединения, поэтому
      // без этого таймера долгоживущая вкладка играла бы от имени пользователя
      // и после того, как его access-токен истёк (7.7). Рвём соединение —
      // клиент реагирует на `disconnect` c причиной 'io server disconnect' и
      // переподключается, а хендшейк заново вычислит личность по свежей куке.
      if (session) {
        const timer = setTimeout(
          () => socket.disconnect(true),
          Math.max(0, session.expiresAt - Date.now()),
        );
        socket.once('disconnect', () => clearTimeout(timer));
      }

      next();
    });

    const estimates = this.options.boardEstimates;
    new RoomsGateway(this.roomsService)
      .onRoundResult(
        estimates &&
          (async (server, roomId) => {
            const linked = await estimates.forRoom(roomId);
            if (linked)
              server.to(linked.boardId).emit(BOARD_WS_SERVER_EVENTS.ESTIMATE, linked.update);
          }),
      )
      .register(io, app.log);
    new BoardsGateway(this.boardsService, this.options.boardVoting)
      .withEstimates(estimates)
      .register(io, app.log);

    io.on('connection', (socket) => {
      app.log.info({ socketId: socket.id, userId: socket.data.userId }, 'Socket.io: подключение');

      // Служебное событие для smoke-проверки соединения. Подтверждение приходит
      // от клиента, поэтому сужаем его до вызываемого типа явно: `typeof === 'function'`
      // даёт голый `Function`, вызов которого не типизирован вообще.
      socket.on('app:ping', (ack: unknown) => {
        if (typeof ack === 'function') {
          (ack as (response: string) => void)('pong');
        }
      });

      socket.on('disconnect', (reason) => {
        app.log.info({ socketId: socket.id, reason }, 'Socket.io: отключение');
      });
    });

    app.decorate('io', io);
    // preClose: закрываем io до остановки http-сервера, чтобы клиенты получили
    // корректный disconnect-пакет, а не обрыв TCP
    app.addHook('preClose', async () => {
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
    });

    return io;
  }

  /**
   * Подключение гостей не запрещаем: вход в комнату по ссылке без входа —
   * штатный сценарий, поэтому неопознанный пользователь просто остаётся гостем.
   */
  private identify(
    app: FastifyInstance,
    cookieHeader: string | undefined,
  ): { userId: string; expiresAt: number } | null {
    try {
      return app.tokens?.readAccessSessionFromCookieHeader(cookieHeader) ?? null;
    } catch (err) {
      app.log.warn({ err }, 'Socket.io: не удалось разобрать куку сессии');
      return null;
    }
  }
}
