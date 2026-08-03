import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';

/**
 * Вызывать до buildApp(): pinoIntegration патчит модуль pino, который Fastify
 * подключает при создании логгера, — если Sentry.init() опоздает, часть логов
 * пройдёт мимо. exitEvenIfOtherHandlersAreRegistered: false — иначе Sentry по
 * умолчанию убивает процесс на uncaughtException, а у нас в index.ts он
 * намеренно логируется и работа продолжается (комнаты не должны падать целиком
 * из-за одной необработанной ошибки).
 */
export function initSentry(dsn: string | undefined): boolean {
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    enableLogs: true,
    integrations: [
      Sentry.pinoIntegration({ log: { levels: ['warn', 'error'] } }),
      Sentry.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: false }),
    ],
  });
  return true;
}

/** onError-хук, не трогает наш ErrorHandler.setErrorHandler — просто репортит попутно */
export function attachSentryErrorHandler(app: FastifyInstance): void {
  Sentry.setupFastifyErrorHandler(app);
}
