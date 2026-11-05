import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../src/errors';
import { ErrorHandler } from '../src/http/error-handler';

let app: FastifyInstance;

async function appThrowing(error: unknown): Promise<FastifyInstance> {
  app = Fastify();
  new ErrorHandler().register(app);
  app.get('/boom', async () => {
    throw error;
  });
  app.get('/logout-like', async (_req, reply) => {
    reply.header('set-cookie', 'pp_access=; Path=/; Max-Age=0');
    throw new UnauthorizedError();
  });
  app.post('/echo', { schema: { body: { type: 'object', required: ['name'] } } }, async () => ({
    ok: true,
  }));
  await app.ready();
  return app;
}

afterEach(async () => {
  await app?.close();
});

describe('ErrorHandler', () => {
  it('переводит ошибки приложения в свои коды и статусы', async () => {
    const cases = [
      [new NotFoundError('Команда не найдена'), 404, 'not_found'],
      [new ForbiddenError('Недостаточно прав'), 403, 'forbidden'],
      [new ConflictError('Передайте владение'), 409, 'conflict'],
      [new UnauthorizedError(), 401, 'unauthorized'],
    ] as const;

    for (const [error, status, code] of cases) {
      const instance = await appThrowing(error);
      const res = await instance.inject({ method: 'GET', url: '/boom' });

      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ error: code, message: error.message });
      await instance.close();
    }
  });

  it('прячет внутренние подробности за общим ответом', async () => {
    const instance = await appThrowing(
      new Error('Failed query: select * from users where id = $1'),
    );

    const res = await instance.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal', message: 'Внутренняя ошибка сервера' });
    expect(res.body).not.toMatch(/select|users/i);
  });

  it('сохраняет сброс кук при ответе 401', async () => {
    const instance = await appThrowing(new NotFoundError('не важно'));

    const res = await instance.inject({ method: 'GET', url: '/logout-like' });

    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeTruthy();
  });

  it('ошибки валидации отдаёт как bad_request', async () => {
    const instance = await appThrowing(new NotFoundError('не важно'));

    const res = await instance.inject({ method: 'POST', url: '/echo', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request' });
  });

  it('на неизвестный маршрут отвечает в том же формате', async () => {
    const instance = await appThrowing(new NotFoundError('не важно'));

    const res = await instance.inject({ method: 'GET', url: '/нет-такого' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });

  it('внутренние коды Fastify наружу не уходят', async () => {
    const instance = await appThrowing(new NotFoundError('не важно'));

    const res = await instance.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'text/plain' },
      payload: 'привет',
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((res.json() as { error: string }).error).not.toMatch(/^FST_/);
  });
});

interface LogRecord {
  level: string;
  message: string;
}

/** Пишем в лог не текстом, а в структуру — так в тесте видно уровень каждой записи */
function fakeLogger(records: LogRecord[]): FastifyBaseLogger {
  const write = (level: string) => (meta: unknown, message?: unknown) => {
    records.push({ level, message: typeof message === 'string' ? message : String(meta) });
  };
  const logger = {
    level: 'info',
    fatal: write('fatal'),
    error: write('error'),
    warn: write('warn'),
    info: write('info'),
    debug: write('debug'),
    trace: write('trace'),
    silent: () => {},
    child: () => logger,
  };
  return logger as unknown as FastifyBaseLogger;
}

describe('ErrorHandler: уровни логов', () => {
  it('протокольный мусор от сканеров пишет на info, а не на warn', async () => {
    const records: LogRecord[] = [];
    app = Fastify({ loggerInstance: fakeLogger(records) });
    new ErrorHandler().register(app);
    app.post('/echo', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/vnd.bot' },
      payload: 'привет',
    });

    expect(res.statusCode).toBe(415);
    expect(records.filter((r) => r.level === 'warn')).toHaveLength(0);
    expect(records.some((r) => r.level === 'info' && r.message === 'Запрос отклонён')).toBe(true);
  });

  it('прочие клиентские отказы остаются на warn', async () => {
    const records: LogRecord[] = [];
    app = Fastify({ loggerInstance: fakeLogger(records) });
    new ErrorHandler().register(app);
    app.get('/limited', async () => {
      throw Object.assign(new Error('Слишком много запросов'), { statusCode: 429 });
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/limited' });

    expect(res.statusCode).toBe(429);
    expect(records.some((r) => r.level === 'warn' && r.message === 'Запрос отклонён')).toBe(true);
  });
});
