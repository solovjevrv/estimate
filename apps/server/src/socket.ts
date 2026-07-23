import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
  }
}

/**
 * Привязывает Socket.io к HTTP-серверу Fastify.
 * Игровые события (join_room и т.д.) добавляются в задаче 2.4,
 * аутентификация подключений — в задаче 2.2.
 */
export function attachSocketIo(app: FastifyInstance, corsOrigin: string): Server {
  const io = new Server(app.server, {
    cors: { origin: corsOrigin },
  });

  io.on('connection', (socket) => {
    app.log.info({ socketId: socket.id }, 'Socket.io: подключение');

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
  app.addHook('onClose', async () => {
    // Всегда резолвим: http-сервер к этому моменту может быть уже закрыт Fastify
    await new Promise<void>((resolve) => {
      void io.close(() => resolve());
    });
  });

  return io;
}
