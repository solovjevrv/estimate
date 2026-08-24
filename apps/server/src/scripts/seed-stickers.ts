import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Readable } from 'node:stream';

import { MinioObjectStorage } from '../platform/storage';
import type { ObjectStorage } from '../platform/storage';
import { loadObjectStorageConfig } from '../config';

/** Регулярка на имя файла стикера внутри pack-директории: hex/digits/dashes + .webp */
const STICKER_FILENAME_RE = /^[a-z0-9-]+\.webp$/i;

/** Ключ объекта в MinIO для стикера: stickers/v1/:pack/:filename */
export function stickerKey(pack: string, filename: string): string {
  return `stickers/v1/${pack}/${filename}`;
}

/**
 * Считать поток целиком в буфер — нужно для сверки SHA-256 при заполнении
 */
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

export interface SeedReport {
  /** Файлов в assetsDir/<pack>/*.webp, подходящих под STICKER_FILENAME_RE */
  scanned: number;
  /** Новых put() в этом запуске */
  uploaded: number;
  /** Уже были в storage с совпадающим SHA-256 — пропущены */
  alreadyInSync: number;
  /** filename — есть в storage, но хеш НЕ совпал с диском (не перезаписывается автоматически!) */
  mismatches: string[];
  /** filename: сообщение — ошибка чтения/put/get на конкретном файле */
  errors: string[];
}

/**
 * Идемпотентное наполнение MinIO встроенными стикер-паками с локального диска.
 * Сверяет по SHA-256: если объект уже в storage с тем же хешом — пропускает,
 * если хеши расходятся — репортует в `mismatches` и не перезаписывает.
 */
export async function seedStickers(opts: {
  assetsDir: string;
  storage: ObjectStorage;
  dryRun: boolean;
}): Promise<SeedReport> {
  const report: SeedReport = {
    scanned: 0,
    uploaded: 0,
    alreadyInSync: 0,
    mismatches: [],
    errors: [],
  };

  let packEntries: Dirent[];
  try {
    packEntries = await readdir(opts.assetsDir, { withFileTypes: true });
  } catch (err) {
    report.errors.push(`readdir: ${(err as Error).message}`);
    return report;
  }

  for (const packDir of packEntries) {
    if (!packDir.isDirectory()) continue;

    const packDirPath = join(opts.assetsDir, packDir.name);
    let fileEntries: Dirent[];
    try {
      fileEntries = await readdir(packDirPath, { withFileTypes: true });
    } catch (err) {
      report.errors.push(`readdir pack ${packDir.name}: ${(err as Error).message}`);
      continue;
    }

    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile()) continue;
      if (!STICKER_FILENAME_RE.test(fileEntry.name)) continue;

      report.scanned++;

      const pack = packDir.name;
      const filename = fileEntry.name;
      const diskPath = join(packDirPath, filename);
      const key = stickerKey(pack, filename);

      let diskBuffer: Buffer;
      try {
        diskBuffer = await readFile(diskPath);
      } catch (err) {
        report.errors.push(`${pack}/${filename}: ${(err as Error).message}`);
        continue;
      }
      const diskHash = sha256(diskBuffer);

      let existing: Readable | null;
      try {
        existing = await opts.storage.get(key);
      } catch (err) {
        report.errors.push(`${pack}/${filename}: ${(err as Error).message}`);
        continue;
      }

      if (existing) {
        let storageBuffer: Buffer;
        try {
          storageBuffer = await streamToBuffer(existing);
        } catch (err) {
          report.errors.push(`${pack}/${filename}: ${(err as Error).message}`);
          continue;
        }
        const storageHash = sha256(storageBuffer);

        if (storageHash === diskHash) {
          report.alreadyInSync++;
        } else {
          // Хеши не совпали — объект в storage «чужой» (или повреждён).
          // Не перезаписываем автоматически: ручное разбирательство.
          report.mismatches.push(`${pack}/${filename}`);
        }
        continue;
      }

      if (opts.dryRun) {
        report.uploaded++;
        continue;
      }

      try {
        await opts.storage.put(key, diskBuffer, 'image/webp');
      } catch (err) {
        report.errors.push(`${pack}/${filename}: ${(err as Error).message}`);
        continue;
      }

      // Обязательно перечитываем и сверяем — если put исказил данные, это ошибка,
      // а не «молодой» seed-успех
      let verifyBuffer: Buffer;
      try {
        const verifyStream = await opts.storage.get(key);
        if (!verifyStream) {
          report.errors.push(`${pack}/${filename}: объект исчез после put`);
          continue;
        }
        verifyBuffer = await streamToBuffer(verifyStream);
      } catch (err) {
        report.errors.push(`${pack}/${filename}: ${(err as Error).message}`);
        continue;
      }

      if (sha256(verifyBuffer) === diskHash) {
        report.uploaded++;
      } else {
        report.errors.push(`${pack}/${filename}: SHA-256 после put не совпадает с исходным`);
      }
    }
  }

  return report;
}

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));

  const assetsDir = join(import.meta.dirname, '..', '..', 'assets', 'sticker-packs');

  const storageConfig = loadObjectStorageConfig();
  if (!storageConfig) {
    console.error(
      'Заполнение стикеров требует настроенного MinIO (MINIO_ACCESS_KEY/MINIO_SECRET_KEY)',
    );
    process.exit(1);
  }

  const storage = new MinioObjectStorage(storageConfig);

  if (dryRun) {
    console.log('Режим dry-run: файлы не будут записаны в storage.\n');
  }

  const report = await seedStickers({ assetsDir, storage, dryRun });

  console.log('--- Отчёт наполнения стикеров ---');
  console.log(`Просканировано:    ${report.scanned}`);
  console.log(`Залито:             ${report.uploaded}`);
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
