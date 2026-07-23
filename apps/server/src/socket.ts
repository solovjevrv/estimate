import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

import { readUserIdFromCookieHeader } from './auth';

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

/**
 * Привязывает Socket.io к HTTP-серверу Fastify.
 * Игровые события (join_room и т.д.) добавляются в задаче 2.4.
 */
export function attachSocketIo(app: FastifyInstance, corsOrigin: string): PokerServer {
  const io: PokerServer = new Server(app.server, {
    // credentials нужен, чтобы браузер слал cookie сессии на дев-фронт (другой origin)
    cors: { origin: corsOrigin, credentials: true },
  });

  // Подключение гостей не запрещаем: вход в комнату по ссылке без входа — штатный сценарий
  io.use((socket, next) => {
    try {
      socket.data.userId = readUserIdFromCookieHeader(app, socket.handshake.headers.cookie);
    } catch (err) {
      // Разбор куки сломался — подключаем как гостя, а не роняем соединение
      app.log.warn({ err, socketId: socket.id }, 'Socket.io: не удалось разобрать куку сессии');
      socket.data.userId = null;
    }
    next();
  });

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
