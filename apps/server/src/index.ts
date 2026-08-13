import { buildApp } from './app';
import { BoardImagesService, BoardTemplatesRepository, BoardsService } from './boards';
import { BOARD_TEMPLATE_SEEDS } from './boards/board-templates-seed-data';
import { loadConfig } from './config';
import { createDb } from './db';
import { attachSentryErrorHandler, initSentry } from './monitoring';
import { RoomsService } from './rooms';
import { SocketGateway } from './socket';

async function main(): Promise<void> {
  const config = loadConfig();
  const sentryEnabled = initSentry(config.sentryDsn);
  const { db, pool } = createDb(config.databaseUrl);

  const app = buildApp(
    {
      db,
      closeDb: async () => {
        await pool.end();
      },
      auth: config.auth,
      docsEnabled: config.docsEnabled,
      avatarsDir: config.avatarsDir,
      boardAssetsDir: config.boardAssetsDir,
    },
    { logger: true },
  );
  if (sentryEnabled) {
    attachSentryErrorHandler(app);
  }

  const roomsService = RoomsService.forDatabase(db, config.auth.guestSecret);
  const boardImagesService = await BoardImagesService.forDirectory(config.boardAssetsDir);
  const boardsService = BoardsService.forDatabase(db, config.auth.guestSecret, boardImagesService);
  new SocketGateway(roomsService, boardsService, { corsOrigin: config.webOrigin }).attach(app);

  // Сидируем встроенные шаблоны досок (15.1) — идемпотентно
  await new BoardTemplatesRepository(db).seedBuiltins(BOARD_TEMPLATE_SEEDS);

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
