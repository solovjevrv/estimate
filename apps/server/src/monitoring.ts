import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';

/**
 * Ошибка, которая по сути является ответом клиенту (4xx), а не поломкой сервера.
 * Статус берём из самой ошибки: `statusCode` есть и у наших AppError, и у
 * FastifyError (FST_ERR_CTP_INVALID_MEDIA_TYPE и прочие), `status` — у ошибок
 * сторонних библиотек.
 */
export function isClientError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status =
    typeof candidate.status === 'number'
      ? candidate.status
      : typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : undefined;
  return status !== undefined && status >= 400 && status < 500;
}

/**
 * Вызывать до buildApp(): pinoIntegration патчит модуль pino, который Fastify
 * подключает при создании логгера, — если Sentry.init() опоздает, часть логов
 * пройдёт мимо. exitEvenIfOtherHandlersAreRegistered: false — иначе Sentry по
 * умолчанию убивает процесс на uncaughtException, а у нас в index.ts он
 * намеренно логируется и работа продолжается (комнаты не должны падать целиком
 * из-за одной необработанной ошибки).
 *
 * beforeSend отсекает 4xx. Свой фильтр нужен потому, что штатный фильтр Sentry
 * (`statusCode >= 500 || <= 299`) смотрит на `reply.statusCode`, а onError-хуки
 * Fastify выполняются ДО setErrorHandler — на этот момент код ответа ещё
 * дефолтный 200, и в issues как «необработанные» падали 401 на просроченную
 * куку, 429 от лимитера, 415 от ботов с посторонним content-type. Такие
 * ответы остаются в логах (pinoIntegration), но issue не создают.
 */
export function initSentry(dsn: string | undefined): boolean {
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    enableLogs: true,
    beforeSend: (event, hint) => (isClientError(hint.originalException) ? null : event),
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
