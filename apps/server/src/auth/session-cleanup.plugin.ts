import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { SessionsRepository } from './sessions.repository';

/** Раз в сутки достаточно — просроченный refresh-токен и так не пройдёт `jwt.verify` независимо от строки в БД (7.29) */
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SessionCleanupPluginOptions {
  /** Переопределение периода для тестов */
  intervalMs?: number;
}

async function sessionCleanupPluginImpl(
  app: FastifyInstance,
  opts: SessionCleanupPluginOptions,
): Promise<void> {
  const repository = new SessionsRepository(app.db);

  const run = async (): Promise<void> => {
    try {
      const deleted = await repository.deleteExpired();
      if (deleted > 0) {
        app.log.info({ deleted }, 'Просроченные сессии удалены');
      }
    } catch (err) {
      app.log.error({ err }, 'Не удалось почистить просроченные сессии');
    }
  };

  void run();
  const timer = setInterval(() => void run(), opts.intervalMs ?? CLEANUP_INTERVAL_MS);
  timer.unref();

  app.addHook('onClose', () => {
    clearInterval(timer);
  });
}

export const sessionCleanupPlugin = fp(sessionCleanupPluginImpl, {
  name: 'estimate-session-cleanup',
});
