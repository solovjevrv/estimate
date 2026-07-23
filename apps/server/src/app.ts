import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(opts);

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));

  return app;
}
