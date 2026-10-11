import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

import { RedisRealtimeStore } from './redis-realtime-store';

/** Всё, что нужно экземпляру, чтобы работать в паре с соседями (10.18) */
export interface RedisCluster {
  /** Команды: общее состояние, лимиты запросов, `/health` */
  client: Redis;
  store: RedisRealtimeStore;
  /** Адаптер Socket.io: рассылки и `fetchSockets` по всем экземплярам */
  adapter: ServerOptions['adapter'];
  close(): Promise<void>;
}

/**
 * Подключения к Redis. Подписка адаптера занимает соединение целиком (в режиме
 * подписки команды недоступны), поэтому у неё своё; публикация — тоже отдельно,
 * чтобы рассылка не стояла в очереди за командами состояния.
 */
export function connectRedisCluster(
  url: string,
  onError: (err: Error, role: string) => void,
  /**
   * Префикс всех ключей и канала рассылок — окружения и тесты на одном Redis
   * не должны видеть друг друга. Ключи префиксует сам ioredis (`keyPrefix`
   * действует на все команды, включая скрипты лимитов), канал адаптера — его `key`
   */
  keyPrefix = 'estimate:',
): RedisCluster {
  // Ограниченные повторы: при недоступном Redis событие должно получить ошибку
  // в разумное время, а не висеть в очереди офлайн-команд
  const client = new Redis(url, { maxRetriesPerRequest: 2, keyPrefix });
  const pub = client.duplicate();
  const sub = client.duplicate();
  for (const [role, connection] of [
    ['client', client],
    ['pub', pub],
    ['sub', sub],
  ] as const) {
    connection.on('error', (err: Error) => onError(err, role));
  }
  return {
    client,
    store: new RedisRealtimeStore(client),
    adapter: createAdapter(pub, sub, { key: `${keyPrefix}socket.io` }),
    async close() {
      await Promise.allSettled([client.quit(), pub.quit(), sub.quit()]);
    },
  };
}
