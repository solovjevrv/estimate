import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { io as createClient } from 'socket.io-client';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, TokenService } from '../src/auth';
import { BoardsService } from '../src/boards';
import type { AuthConfig } from '../src/config';
import type { Db } from '../src/db';
import { RoomsService } from '../src/rooms';
import { SocketGateway } from '../src/socket';

const authConfig: AuthConfig = {
  jwtSecret: 'секрет-для-тестов-длиннее-тридцати-двух-символов',
  guestSecret: 'гостевой-секрет-для-тестов-длиннее-тридцати-двух',
  publicOrigin: 'http://localhost:3000',
  webOrigin: 'http://localhost:5173',
  cookieSecure: false,
  providers: {},
};

async function startApp(auth?: AuthConfig): Promise<{ app: FastifyInstance; port: number }> {
  const db = { execute: vi.fn() } as unknown as Db;
  const app = buildApp({ db, auth });
  const roomsService = RoomsService.forDatabase(db, authConfig.guestSecret);
  const boardsService = BoardsService.forDatabase(db, authConfig.guestSecret);
  new SocketGateway(roomsService, boardsService, { corsOrigin: '*' }).attach(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, port: (app.server.address() as AddressInfo).port };
}

/** Подключается к серверу и возвращает userId, который сервер определил для сокета */
async function connectAndReadUserId(
  app: FastifyInstance,
  port: number,
  cookie?: string,
): Promise<string | null> {
  const connected = new Promise<string | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('сокет не подключился за 3 секунды')), 3_000);
    app.io.once('connection', (socket) => {
      clearTimeout(timer);
      resolve(socket.data.userId);
    });
  });
  const client = createClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : {},
  });
  try {
    return await connected;
  } finally {
    client.close();
  }
}

describe('Socket.io', () => {
  it('принимает подключение и отвечает pong на app:ping', async () => {
    const { app, port } = await startApp();

    const client = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
    try {
      const answer = await new Promise<string>((resolve, reject) => {
        client.on('connect_error', reject);
        client.emit('app:ping', (res: string) => resolve(res));
      });

      expect(answer).toBe('pong');
    } finally {
      client.close();
      await app.close();
    }
  });

  it('опознаёт пользователя по access-куке', async () => {
    const { app, port } = await startApp(authConfig);
    try {
      const { access } = new TokenService(app.jwt, false).issue('user-42', 'session-42');

      const userId = await connectAndReadUserId(app, port, `${ACCESS_COOKIE}=${access}`);

      expect(userId).toBe('user-42');
    } finally {
      await app.close();
    }
  });

  it('пускает гостя без куки — userId остаётся null', async () => {
    const { app, port } = await startApp(authConfig);
    try {
      expect(await connectAndReadUserId(app, port)).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('не верит подделанной куке', async () => {
    const { app, port } = await startApp(authConfig);
    try {
      const userId = await connectAndReadUserId(app, port, `${ACCESS_COOKIE}=forged.jwt.value`);

      expect(userId).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('рвёт соединение сразу после истечения access-токена (7.7)', async () => {
    const { app, port } = await startApp(authConfig);
    try {
      const access = app.jwt.sign({ sub: 'user-42', typ: 'access' }, { expiresIn: 1 });
      const client = createClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        extraHeaders: { cookie: `${ACCESS_COOKIE}=${access}` },
      });

      try {
        const reason = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('сокет не был отключён за 3 секунды')),
            3_000,
          );
          client.on('disconnect', (r: string) => {
            clearTimeout(timer);
            resolve(r);
          });
        });

        expect(reason).toBe('io server disconnect');
      } finally {
        client.close();
      }
    } finally {
      await app.close();
    }
  });

  it('не рвёт соединение гостя без куки', async () => {
    const { app, port } = await startApp(authConfig);
    try {
      const client = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
      try {
        await new Promise<void>((resolve, reject) => {
          client.on('connect', () => resolve());
          client.on('connect_error', reject);
        });

        const stillConnected = await new Promise<boolean>((resolve) => {
          client.once('disconnect', () => resolve(false));
          setTimeout(() => resolve(client.connected), 1_500);
        });

        expect(stillConnected).toBe(true);
      } finally {
        client.close();
      }
    } finally {
      await app.close();
    }
  });
});
