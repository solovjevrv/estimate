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
      docsEnabled: config.docsEnabled,
    },
    { logger: true },
  );

  new SocketGateway({ corsOrigin: config.webOrigin, guestSecret: config.auth.guestSecret }).attach(
    app,
  );

  // Одна неудачная операция не должна уносить процесс вместе со всеми комнатами
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'Необработанный отказ промиса');
  });
  process.on('uncaughtException', (err) => {
    app.log.error({ err }, 'Необработанное исключение');
  });

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
