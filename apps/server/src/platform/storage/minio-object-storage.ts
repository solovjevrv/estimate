import type { Readable } from 'node:stream';

import { Client } from 'minio';

import type { ObjectStorage } from './object-storage';

export interface MinioObjectStorageOptions {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

/** MinIO отдаёт `NoSuchKey` (S3-совместимый код) на чтение отсутствующего объекта */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'NoSuchKey';
}

/**
 * MinIO — единственная реализация `ObjectStorage` на проде (Epic 21). Бакет уже
 * должен существовать (создаётся idempotent init-job'ом в Compose, не здесь) —
 * адаптер не создаёт и не настраивает инфраструктуру, только кладёт/читает/
 * удаляет объекты в уже готовом бакете.
 */
export class MinioObjectStorage implements ObjectStorage {
  private readonly client: Client;
  private readonly bucket: string;

  constructor(opts: MinioObjectStorageOptions) {
    this.client = new Client({
      endPoint: opts.endpoint,
      port: opts.port,
      useSSL: opts.useSSL,
      accessKey: opts.accessKey,
      secretKey: opts.secretKey,
    });
    this.bucket = opts.bucket;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, body, body.length, {
      'Content-Type': contentType,
    });
  }

  async get(key: string): Promise<Readable | null> {
    try {
      return await this.client.getObject(this.bucket, key);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  /** Бакет должен существовать (создан init-job'ом) — отсутствие бакета тоже считаем недоступностью */
  async ping(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      throw new Error(`Бакет "${this.bucket}" не найден`);
    }
  }
}
