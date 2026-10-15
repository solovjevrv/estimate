import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

/**
 * Счётчики лимитов — общие для всех экземпляров сервера (10.18): без этого
 * при N экземплярах каждый лимит фактически умножался бы на N, общая квота
 * Giphy — тоже. Без Redis — в памяти процесса, как раньше.
 *
 * Redis недоступен — лимит пропускается, а не роняет запрос: вход в систему
 * важнее защиты от перебора на время сбоя.
 */
export function sharedRateLimitStore(
  app: FastifyInstance,
  nameSpace: string,
): Pick<RateLimitPluginOptions, 'redis' | 'nameSpace' | 'skipOnError'> {
  if (!app.redis) return {};
  // Префикс окружения (`estimate:`) клиент добавляет к ключам сам
  return { redis: app.redis, nameSpace: `rl:${nameSpace}:`, skipOnError: true };
}
