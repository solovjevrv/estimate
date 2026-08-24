import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Readable } from 'node:stream';

import { MinioObjectStorage } from '../platform/storage';
import type { ObjectStorage } from '../platform/storage';
import { loadObjectStorageConfig } from '../config';
import { FILENAME_RE, avatarKey } from '../auth/avatar.service';

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

export interface MigrationReport {
  /** Файлов в legacyDir, подходящих под FILENAME_RE */
  scanned: number;
  /** Новых put() в этом запуске */
  migrated: number;
  /** Уже были в storage с совпадающим SHA-256 — пропущены */
  alreadyInSync: number;
  /** filename — есть в storage, но хеш НЕ совпал с диском (не перезаписывается автоматически!) */
  mismatches: string[];
  /** filename: сообщение — ошибка чтения/put/get на конкретном файле */
  errors: string[];
}

/**
 * Идемпотентная миграция аватарок с локального диска в ObjectStorage.
 * Сверяет по SHA-256: если объект уже в storage с тем же хешом — пропускает,
 * если хеши расходятся — репортует в `mismatches` и не перезаписывает.
 * Исходный файл на диске никогда не удаляется.
 */
export async function migrateAvatars(opts: {
  legacyDir: string;
  storage: ObjectStorage;
  dryRun: boolean;
}): Promise<MigrationReport> {
  const report: MigrationReport = {
    scanned: 0,
    migrated: 0,
    alreadyInSync: 0,
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

  // FILENAME_RE держать в синхроне с avatar.service.ts — импортировано оттуда
  const files = entries.filter((name) => FILENAME_RE.test(name));

  for (const filename of files) {
    report.scanned++;

    const diskPath = join(opts.legacyDir, filename);
    const key = avatarKey(filename);

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

  const legacyDir = process.env.AVATARS_DIR ?? join(process.cwd(), 'avatars');

  const storageConfig = loadObjectStorageConfig();
  if (!storageConfig) {
    console.error(
      'Миграция аватарок требует настроенного MinIO (MINIO_ACCESS_KEY/MINIO_SECRET_KEY)',
    );
    process.exit(1);
  }

  const storage = new MinioObjectStorage(storageConfig);

  if (dryRun) {
    console.log('Режим dry-run: файлы не будут записаны в storage.\n');
  }

  const report = await migrateAvatars({ legacyDir, storage, dryRun });

  console.log('--- Отчёт миграции аватарок ---');
  console.log(`Просканировано:    ${report.scanned}`);
  console.log(`Перенесено:        ${report.migrated}`);
  console.log(`Уже в синхроне:     ${report.alreadyInSync}`);
  if (report.mismatches.length > 0) {
    console.log(`Расхождения (${report.mismatches.length}):`);
    for (const f of report.mismatches) {
      console.log(`  ${f}`);
    }
  }
  if (report.errors.length > 0) {
    console.log(`Ошибки (${report.errors.length}):`);
    for (const e of report.errors) {
      console.log(`  ${e}`);
    }
  }

  process.exitCode = report.mismatches.length > 0 || report.errors.length > 0 ? 1 : 0;
}

// Только при прямом запуске (не при импорте из тестов)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
