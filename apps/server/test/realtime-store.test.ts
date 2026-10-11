/**
 * Один контракт на обе реализации общего состояния realtime (10.18): в памяти
 * процесса и в Redis. Redis-часть — только при REDIS_URL (как БД-тесты при
 * DATABASE_URL), каждый тест — в своём префиксе ключей.
 */
import { randomUUID } from 'node:crypto';

import type { BoardOpsBatch } from '@estimate/shared';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

import { BoardOpsLog } from '../src/boards/board-ops-log';
import {
  MemoryRealtimeStore,
  REALTIME_TTL_SEC,
  RedisRealtimeStore,
  type RealtimeStore,
} from '../src/platform/realtime';

const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true }) : null;

afterAll(async () => {
  await redis?.quit();
});

const implementations: Array<[string, () => RealtimeStore, boolean]> = [
  ['память процесса', () => new MemoryRealtimeStore(), true],
  ['Redis', () => new RedisRealtimeStore(redis!, `estimate:test:${randomUUID()}:`), redis !== null],
];

describe.each(implementations)('RealtimeStore: %s', (_name, create, enabled) => {
  describe.runIf(enabled)('контракт', () => {
    it('JSON: запись, чтение, удаление; отсутствующий ключ — null', async () => {
      const store = create();
      expect(await store.getJson('a')).toBeNull();
      await store.setJson('a', { running: true, n: 3 });
      expect(await store.getJson('a')).toEqual({ running: true, n: 3 });
      await store.delete('a', 'не-было');
      expect(await store.getJson('a')).toBeNull();
    });

    it('хэш: поля независимы, удаление поля не трогает остальные', async () => {
      const store = create();
      await store.hashSet('h', 'x', '1');
      await store.hashSet('h', 'y', '2');
      await store.hashSet('h', 'x', '3');
      expect(await store.hashGet('h', 'x')).toBe('3');
      await store.hashDelete('h', 'y');
      expect(await store.hashGetAll('h')).toEqual([['x', '3']]);
      expect(await store.hashGetAll('пусто')).toEqual([]);
      expect(await store.hashGet('пусто', 'x')).toBeNull();
    });

    it('nextSeq: строго растёт и не меньше текущего времени', async () => {
      const store = create();
      const before = Date.now();
      const first = await store.nextSeq('s');
      const second = await store.nextSeq('s');
      const third = await store.nextSeq('s');
      expect(first).toBeGreaterThanOrEqual(before - 1000);
      expect(second).toBeGreaterThan(first);
      expect(third).toBeGreaterThan(second);
    });

    it('nextSeq: после потери счётчика номер не откатывается назад', async () => {
      const store = create();
      const before = await store.nextSeq('s');
      await store.delete('s');
      expect(await store.nextSeq('s')).toBeGreaterThanOrEqual(before);
    });

    it('упорядоченный набор: по возрастанию, только последние cap, повтор score заменяет', async () => {
      const store = create();
      for (const score of [3, 1, 2, 4]) {
        await store.sortedAdd('z', score, `v${score}`, 3);
      }
      await store.sortedAdd('z', 4, 'v4-заново', 3);
      expect(await store.sortedAbove('z', 0)).toEqual([
        { score: 2, member: 'v2' },
        { score: 3, member: 'v3' },
        { score: 4, member: 'v4-заново' },
      ]);
      expect(await store.sortedAbove('z', 3)).toEqual([{ score: 4, member: 'v4-заново' }]);
    });

    it('ping не бросает на живом хранилище', async () => {
      await expect(create().ping()).resolves.toBeUndefined();
    });
  });
});

describe.runIf(redis !== null)('RedisRealtimeStore: срок жизни', () => {
  it('каждая запись ставит TTL — брошенные комнаты не копятся', async () => {
    const prefix = `estimate:test:${randomUUID()}:`;
    const store = new RedisRealtimeStore(redis!, prefix);
    await store.setJson('j', 1);
    await store.hashSet('h', 'f', 'v');
    await store.nextSeq('s');
    await store.sortedAdd('z', 1, 'm', 10);
    for (const key of ['j', 'h', 's', 'z']) {
      const ttl = await redis!.ttl(`${prefix}${key}`);
      expect(ttl).toBeGreaterThan(REALTIME_TTL_SEC - 10);
    }
  });
});

describe('MemoryRealtimeStore: срок жизни', () => {
  it('просроченный ключ не читается и вычищается', async () => {
    let now = 1_000_000;
    const store = new MemoryRealtimeStore(() => now);
    await store.setJson('a', 1);
    now += REALTIME_TTL_SEC * 1000;
    expect(await store.getJson('a')).toBeNull();
    expect(store.size).toBe(0);
  });
});

function batch(revision: number): BoardOpsBatch {
  return { revision, ops: [] };
}

describe('BoardOpsLog: догон без дыр (10.18)', () => {
  it('отдаёт батчи после sinceRevision до текущей ревизии, если они идут подряд', async () => {
    const log = new BoardOpsLog(new MemoryRealtimeStore(), 10);
    for (const revision of [1, 2, 3, 4]) await log.push('b', batch(revision));

    expect((await log.catchup('b', 1, 4))?.map((b) => b.revision)).toEqual([2, 3, 4]);
  });

  it('клиент уже на текущей ревизии — догонять нечего', async () => {
    const log = new BoardOpsLog(new MemoryRealtimeStore(), 10);
    expect(await log.catchup('b', 5, 5)).toEqual([]);
  });

  it('батчи пришли не по порядку (с разных экземпляров) — порядок по ревизии', async () => {
    const log = new BoardOpsLog(new MemoryRealtimeStore(), 10);
    for (const revision of [2, 4, 1, 3]) await log.push('b', batch(revision));

    expect((await log.catchup('b', 0, 4))?.map((b) => b.revision)).toEqual([1, 2, 3, 4]);
  });

  it('батч ещё не записан (дыра) — null, нужен полный снимок', async () => {
    const log = new BoardOpsLog(new MemoryRealtimeStore(), 10);
    for (const revision of [1, 2, 4]) await log.push('b', batch(revision));

    expect(await log.catchup('b', 1, 4)).toBeNull();
  });

  it('последний закоммиченный батч ещё не дошёл до буфера — null', async () => {
    const log = new BoardOpsLog(new MemoryRealtimeStore(), 10);
    for (const revision of [1, 2, 3]) await log.push('b', batch(revision));

    expect(await log.catchup('b', 1, 4)).toBeNull();
  });

  it('клиент отстал дальше, чем помнит буфер — null', async () => {
    const log = new BoardOpsLog(new MemoryRealtimeStore(), 3);
    for (const revision of [1, 2, 3, 4, 5]) await log.push('b', batch(revision));

    expect(await log.catchup('b', 1, 5)).toBeNull();
    expect((await log.catchup('b', 2, 5))?.map((b) => b.revision)).toEqual([3, 4, 5]);
  });

  it('батчи новее текущей ревизии не отдаются — они придут рассылкой', async () => {
    const log = new BoardOpsLog(new MemoryRealtimeStore(), 10);
    for (const revision of [1, 2, 3]) await log.push('b', batch(revision));

    expect((await log.catchup('b', 0, 2))?.map((b) => b.revision)).toEqual([1, 2]);
  });

  it('ревизия клиента впереди БД — null', async () => {
    const log = new BoardOpsLog(new MemoryRealtimeStore(), 10);
    expect(await log.catchup('b', 7, 3)).toBeNull();
  });
});
