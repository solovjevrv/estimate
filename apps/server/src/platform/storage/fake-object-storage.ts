import { Readable } from 'node:stream';

import type { ObjectStorage } from './object-storage';

interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * In-memory реализация `ObjectStorage` для юнит-тестов — без реального MinIO.
 * `available` эмулирует недоступность хранилища (для тестов health-проверок
 * и обработки отказа), не влияет на уже сохранённые объекты.
 */
export class FakeObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();
  available = true;

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.available) throw new Error('Хранилище недоступно');
    this.objects.set(key, { body, contentType });
  }

  async get(key: string): Promise<Readable | null> {
    if (!this.available) throw new Error('Хранилище недоступно');
    const stored = this.objects.get(key);
    return stored ? Readable.from(stored.body) : null;
  }

  async remove(key: string): Promise<void> {
    if (!this.available) throw new Error('Хранилище недоступно');
    this.objects.delete(key);
  }

  async ping(): Promise<void> {
    if (!this.available) throw new Error('Хранилище недоступно');
  }

  /** Только для тестов — прочитать сохранённое без публичного get()/потока */
  peek(key: string): StoredObject | undefined {
    return this.objects.get(key);
  }
}
