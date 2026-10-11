import type { Redis } from 'ioredis';

import { REALTIME_TTL_SEC, type RealtimeStore } from './realtime-store';

/**
 * max(прошлый + 1, время Redis в мс) — время берётся у самого Redis, а не у
 * экземпляра сервера: часы у экземпляров могут расходиться
 */
const NEXT_SEQ_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local next = tonumber(redis.call('GET', KEYS[1]) or '0') + 1
if now > next then next = now end
redis.call('SET', KEYS[1], next, 'EX', ARGV[1])
return next
`;

/** Несколько экземпляров сервера: общее состояние в Redis */
export class RedisRealtimeStore implements RealtimeStore {
  constructor(
    private readonly redis: Redis,
    /**
     * Префикс ключей состояния. Общий префикс окружения (`estimate:`) клиент
     * добавляет сам — см. `connectRedisCluster`
     */
    private readonly prefix = 'rt:',
  ) {}

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.key(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async setJson(key: string, value: unknown): Promise<void> {
    await this.redis.set(this.key(key), JSON.stringify(value), 'EX', REALTIME_TTL_SEC);
  }

  async delete(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.redis.del(...keys.map((key) => this.key(key)));
  }

  async hashGetAll(key: string): Promise<Array<[string, string]>> {
    return Object.entries(await this.redis.hgetall(this.key(key)));
  }

  async hashGet(key: string, field: string): Promise<string | null> {
    return this.redis.hget(this.key(key), field);
  }

  async hashSet(key: string, field: string, value: string): Promise<void> {
    const full = this.key(key);
    await this.redis.multi().hset(full, field, value).expire(full, REALTIME_TTL_SEC).exec();
  }

  async hashDelete(key: string, field: string): Promise<void> {
    await this.redis.hdel(this.key(key), field);
  }

  async nextSeq(key: string): Promise<number> {
    const result = await this.redis.eval(NEXT_SEQ_SCRIPT, 1, this.key(key), REALTIME_TTL_SEC);
    return Number(result);
  }

  async sortedAdd(key: string, score: number, member: string, cap: number): Promise<void> {
    const full = this.key(key);
    await this.redis
      .multi()
      // Одна запись на score: повтор той же ревизии заменяет, а не дублирует
      .zremrangebyscore(full, score, score)
      .zadd(full, score, member)
      .zremrangebyrank(full, 0, -(cap + 1))
      .expire(full, REALTIME_TTL_SEC)
      .exec();
  }

  async sortedAbove(
    key: string,
    minExclusive: number,
  ): Promise<Array<{ score: number; member: string }>> {
    const flat = await this.redis.zrangebyscore(
      this.key(key),
      `(${minExclusive}`,
      '+inf',
      'WITHSCORES',
    );
    const result: Array<{ score: number; member: string }> = [];
    for (let i = 0; i < flat.length; i += 2) {
      result.push({ member: flat[i]!, score: Number(flat[i + 1]) });
    }
    return result;
  }

  async ping(): Promise<void> {
    await this.redis.ping();
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }
}
