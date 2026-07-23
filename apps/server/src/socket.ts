import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

import { RoomsGateway, RoomsService } from './rooms';

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

declare module 'fastify' {
  interface FastifyInstance {
    io: PokerServer;
  }
}

export interface SocketGatewayOptions {
  /** Origin дев-фронта для CORS */
  corsOrigin: string;
  /** Секрет подписи гостевых токенов — тот же, что и у сессии */
  guestSecret: string;
}

/** Socket.io поверх HTTP-сервера Fastify вместе с событиями игрового стола */
export class SocketGateway {
  constructor(private readonly options: SocketGatewayOptions) {}

  attach(app: FastifyInstance): PokerServer {
    const io: PokerServer = new Server(app.server, {
      // credentials нужен, чтобы браузер слал cookie сессии на дев-фронт (другой origin)
      cors: { origin: this.options.corsOrigin, credentials: true },
    });

    io.use((socket, next) => {
      socket.data.userId = this.identify(app, socket.handshake.headers.cookie);
      next();
    });

    new RoomsGateway(RoomsService.forDatabase(app.db, this.options.guestSecret)).register(
      io,
      app.log,
    );

    io.on('connection', (socket) => {
      app.log.info({ socketId: socket.id, userId: socket.data.userId }, 'Socket.io: подключение');

      // Служебное событие для smoke-проверки соединения
      socket.on('app:ping', (ack: unknown) => {
        if (typeof ack === 'function') {
          ack('pong');
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
  private identify(app: FastifyInstance, cookieHeader: string | undefined): string | null {
    try {
      return app.tokens?.readUserIdFromCookieHeader(cookieHeader) ?? null;
    } catch (err) {
      app.log.warn({ err }, 'Socket.io: не удалось разобрать куку сессии');
      return null;
    }
  }
}
