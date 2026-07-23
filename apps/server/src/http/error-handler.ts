import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../errors';

interface ErrorResponse {
  error: string;
  message: string;
}

/**
 * Единая точка превращения исключений в HTTP-ответы.
 * Наружу уходят только осмысленные сообщения: текст SQL, параметры запроса
 * и прочие внутренности остаются в логах.
 */
export class ErrorHandler {
  register(app: FastifyInstance): void {
    app.setErrorHandler((err, req, reply) => this.handle(err, req, reply));
  }

  private handle(err: unknown, req: FastifyRequest, reply: FastifyReply): FastifyReply {
    if (err instanceof AppError) {
      req.log.info({ err: { name: err.name, message: err.message } }, 'Запрос отклонён');
      return this.send(reply, err.statusCode, { error: err.code, message: err.message });
    }

    const fastifyError = err as FastifyError;
    if (fastifyError.validation) {
      req.log.info({ err }, 'Запрос не прошёл валидацию');
      return this.send(reply, 400, { error: 'bad_request', message: fastifyError.message });
    }

    const status = fastifyError.statusCode ?? 500;
    if (status < 500) {
      req.log.warn({ err }, 'Запрос отклонён');
      return this.send(reply, status, {
        error: fastifyError.code ?? 'bad_request',
        message: fastifyError.message,
      });
    }

    req.log.error({ err }, 'Необработанная ошибка запроса');
    return this.send(reply, status, { error: 'internal', message: 'Внутренняя ошибка сервера' });
  }

  private send(reply: FastifyReply, status: number, body: ErrorResponse): FastifyReply {
    return reply.code(status).send(body);
  }
}
