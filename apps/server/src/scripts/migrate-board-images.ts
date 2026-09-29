import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Readable } from 'node:stream';

import { loadObjectStorageConfig } from '../config';
import { createDb, schema, type Db } from '../db';
import { MinioObjectStorage, type ObjectStorage } from '../platform/storage';
import { FILENAME_RE, boardImageKey } from '../boards/board-images.service';

/** Считать поток целиком в буфер — нужно для сверки SHA-256 при миграции */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Строит связь filename → boardId по content.url активных элементов-картинок всех досок */
export async function buildFilenameToBoardId(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ boardId: schema.boardItems.boardId, content: schema.boardItems.content })
    .from(schema.boardItems);

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.content.type !== 'image') continue;
    const url = row.content.url;
    const filename = url.slice(url.lastIndexOf('/') + 1);
    if (!FILENAME_RE.test(filename)) continue; // защитно — не должно случаться при валидной записи
    map.set(filename, row.boardId);
  }
  return map;
}

export interface BoardImagesMigrationReport {
  scanned: number;
  migrated: number;
  alreadyInSync: number;
  /** Файл на диске есть, но ни одна доска в БД на него не ссылается — не переносится
   * (некому назначить boardId для ключа), исходник остаётся на диске */
  orphaned: string[];
  mismatches: string[];
  errors: string[];
}

/**
 * Идемпотентная миграция картинок досок с локального диска в ObjectStorage.
 * Ключ storage содержит boardId, поэтому известен только через БД
 * (buildFilenameToBoardId). Сверяет по SHA-256: если объект уже в storage с
 * тем же хешом — пропускает, если хеши расходятся — репортует в `mismatches`
 * и не перезаписывает. Исходный файл на диске никогда не удаляется.
 */
export async function migrateBoardImages(opts: {
  legacyDir: string;
  storage: ObjectStorage;
  filenameToBoardId: ReadonlyMap<string, string>;
  dryRun: boolean;
}): Promise<BoardImagesMigrationReport> {
  const report: BoardImagesMigrationReport = {
    scanned: 0,
    migrated: 0,
    alreadyInSync: 0,
    orphaned: [],
    mismatches: [],
    errors: [],
  };

  let entries: string[];
  try {
    entries = await readdir(opts.legacyDir);
  } catch (err) {
    report.errors.push(`readdir: ${(err as Error).message}`);
    return report;
  }

  // FILENAME_RE держать в синхроне с board-images.service.ts — импортировано оттуда
  const files = entries.filter((name) => FILENAME_RE.test(name));

  for (const filename of files) {
    report.scanned++;

    // Файл без ссылки в БД — осиротевший: некому назначить boardId для ключа,
    // не переносим (может быть чужой доски или мусором). Исходник не трогаем.
    if (!opts.filenameToBoardId.has(filename)) {
      report.orphaned.push(filename);
      continue;
    }
    const boardId = opts.filenameToBoardId.get(filename)!;
    const key = boardImageKey(boardId, filename);

    const diskPath = join(opts.legacyDir, filename);
    let diskBuffer: Buffer;
    try {
      diskBuffer = await readFile(diskPath);
    } catch (err) {
      report.errors.push(`${filename}: ${(err as Error).message}`);
      continue;
    }
    const diskHash = sha256(diskBuffer);

    let existing: Readable | null;
    try {
      existing = await opts.storage.get(key);
    } catch (err) {
      report.errors.push(`${filename}: ${(err as Error).message}`);
      continue;
    }

    if (existing) {
      let storageBuffer: Buffer;
      try {
        storageBuffer = await streamToBuffer(existing);
      } catch (err) {
        report.errors.push(`${filename}: ${(err as Error).message}`);
        continue;
      }
      const storageHash = sha256(storageBuffer);

      if (storageHash === diskHash) {
        report.alreadyInSync++;
      } else {
        // Хеши не совпали — объект в storage «чужой» (или повреждён).
        // Не перезаписываем автоматически: ручное разбирательство.
        report.mismatches.push(filename);
      }
      continue;
    }

    if (opts.dryRun) {
      report.migrated++;
      continue;
    }

    try {
      await opts.storage.put(key, diskBuffer, 'image/webp');
    } catch (err) {
      report.errors.push(`${filename}: ${(err as Error).message}`);
      continue;
    }

    // Обязательно перечитываем и сверяем — если put исказил данные, это ошибка,
    // а не «молодой» миграционный успех
    let verifyBuffer: Buffer;
    try {
      const verifyStream = await opts.storage.get(key);
      if (!verifyStream) {
        report.errors.push(`${filename}: объект исчез после put`);
        continue;
      }
      verifyBuffer = await streamToBuffer(verifyStream);
    } catch (err) {
      report.errors.push(`${filename}: ${(err as Error).message}`);
      continue;
    }

    if (sha256(verifyBuffer) === diskHash) {
      report.migrated++;
    } else {
      report.errors.push(`${filename}: SHA-256 после put не совпадает с исходным`);
    }
  }

  return report;
}

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const legacyDir = process.env.BOARD_ASSETS_DIR ?? join(process.cwd(), 'board-assets');

  const storageConfig = loadObjectStorageConfig();
  if (!storageConfig) {
    console.error(
      'Миграция картинок досок требует настроенного MinIO (MINIO_ACCESS_KEY/MINIO_SECRET_KEY)',
    );
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Миграция картинок досок требует DATABASE_URL (для связи filename → boardId)');
    process.exit(1);
  }

  const storage = new MinioObjectStorage(storageConfig);
  const { db, pool } = createDb(databaseUrl);
  try {
    if (dryRun) console.log('Режим dry-run: файлы не будут записаны в storage.\n');
    const filenameToBoardId = await buildFilenameToBoardId(db);
    const report = await migrateBoardImages({ legacyDir, storage, filenameToBoardId, dryRun });

    console.log('--- Отчёт миграции картинок досок ---');
    console.log(`Просканировано:  ${report.scanned}`);
    console.log(`Перенесено:      ${report.migrated}`);
    console.log(`Уже в синхроне:  ${report.alreadyInSync}`);
    if (report.orphaned.length > 0) {
      console.log(`Осиротевшие, без ссылки в БД (${report.orphaned.length}, не перенесены):`);
      for (const f of report.orphaned) console.log(`  ${f}`);
    }
    if (report.mismatches.length > 0) {
      console.log(`Расхождения (${report.mismatches.length}):`);
      for (const f of report.mismatches) console.log(`  ${f}`);
    }
    if (report.errors.length > 0) {
      console.log(`Ошибки (${report.errors.length}):`);
      for (const e of report.errors) console.log(`  ${e}`);
    }
    // orphaned НЕ влияет на exit code — это ожидаемый мусор, не сбой миграции
    process.exitCode = report.mismatches.length > 0 || report.errors.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
