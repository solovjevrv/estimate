import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db';
import { SocketGateway } from './socket';

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, pool } = createDb(config.databaseUrl);

  const app = buildApp(
    {
      db,
      closeDb: async () => {
        await pool.end();
      },
      auth: config.auth,
    },
    { logger: true },
  );

  new SocketGateway(config.webOrigin).attach(app);

  // При остановке контейнера (SIGTERM) дожидаемся закрытия Fastify и его onClose-хуков
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Останавливаю сервер');
      void app.close().then(
        () => process.exit(0),
        (err) => {
          app.log.error(err, 'Ошибка при остановке');
          process.exit(1);
        },
      );
    });
  }

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
