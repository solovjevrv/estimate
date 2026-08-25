import { buildApp } from './app';
import { BoardImagesService, BoardsService } from './boards';
import { loadConfig } from './config';
import { createDb } from './db';
import { attachSentryErrorHandler, initSentry } from './monitoring';
import { MinioObjectStorage } from './platform/storage';
import { RoomsGameService } from './rooms';
import { SocketGateway } from './socket';
import { seedStickers } from './scripts/seed-stickers';

async function main(): Promise<void> {
  const config = loadConfig();
  const sentryEnabled = initSentry(config.sentryDsn);
  const { db, pool } = createDb(config.databaseUrl);
  const objectStorage = config.objectStorage
    ? new MinioObjectStorage(config.objectStorage)
    : undefined;

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
      objectStorage,
      telegram: config.telegram,
    },
    { logger: true },
  );
  if (sentryEnabled) {
    attachSentryErrorHandler(app);
  }

  const roomsService = RoomsGameService.forDatabase(db, config.auth.guestSecret);
  const boardImagesService = objectStorage
    ? BoardImagesService.create(objectStorage, config.boardAssetsDir)
    : undefined;
  const boardsService = BoardsService.forDatabase(
    db,
    config.auth.guestSecret,
    boardImagesService,
    app.log,
  );
  new SocketGateway(roomsService, boardsService, { corsOrigin: config.webOrigin }).attach(app);

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

  if (objectStorage) {
    try {
      // process.cwd() как у avatarsDir/boardAssetsDir (config.ts), не
      // import.meta.dirname — tsup бандлит index.ts в CJS, где import.meta
      // подменяется на пустой объект-шим, и import.meta.dirname всегда
      // undefined в собранном dist/index.cjs (в отличие от seed-stickers.ts,
      // который не входит в tsup entry и всегда исполняется напрямую через
      // tsx — там import.meta.dirname рабочий).
      const report = await seedStickers({
        assetsDir: config.stickersAssetsDir,
        storage: objectStorage,
        dryRun: false,
      });
      if (report.errors.length > 0 || report.mismatches.length > 0) {
        app.log.warn({ report }, 'Наполнение стикеров в MinIO завершилось с замечаниями');
      } else {
        app.log.info({ report }, 'Стикеры наполнены в MinIO');
      }
    } catch (err) {
      app.log.error({ err }, 'Не удалось наполнить стикеры в MinIO — сервер продолжает запуск');
    }
  }

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
