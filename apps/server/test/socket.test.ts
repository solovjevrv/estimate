import type { AddressInfo } from 'node:net';

import { io as createClient } from 'socket.io-client';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import type { Db } from '../src/db';
import { attachSocketIo } from '../src/socket';

describe('Socket.io', () => {
  it('принимает подключение и отвечает pong на app:ping', async () => {
    const app = buildApp({ db: { execute: vi.fn() } as unknown as Db });
    attachSocketIo(app, '*');
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

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
});
