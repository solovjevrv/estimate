import { describe, expect, it } from 'vitest';

import { FakeObjectStorage } from '../src/platform/storage';

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

describe('FakeObjectStorage', () => {
  it('put затем get отдаёт тот же буфер', async () => {
    const storage = new FakeObjectStorage();
    await storage.put('avatars/a.webp', Buffer.from('hello'), 'image/webp');

    const stream = await storage.get('avatars/a.webp');
    expect(stream).not.toBeNull();
    expect((await readAll(stream!)).toString()).toBe('hello');
  });

  it('get отсутствующего ключа отдаёт null', async () => {
    const storage = new FakeObjectStorage();

    await expect(storage.get('nope')).resolves.toBeNull();
  });

  it('remove убирает объект — последующий get отдаёт null', async () => {
    const storage = new FakeObjectStorage();
    await storage.put('k', Buffer.from('x'), 'text/plain');

    await storage.remove('k');

    await expect(storage.get('k')).resolves.toBeNull();
  });

  it('remove отсутствующего ключа не бросает', async () => {
    const storage = new FakeObjectStorage();

    await expect(storage.remove('nope')).resolves.toBeUndefined();
  });

  it('ping не бросает, пока available=true', async () => {
    const storage = new FakeObjectStorage();

    await expect(storage.ping()).resolves.toBeUndefined();
  });

  it('available=false эмулирует недоступность хранилища для put/get/remove/ping', async () => {
    const storage = new FakeObjectStorage();
    storage.available = false;

    await expect(storage.put('k', Buffer.from('x'), 'text/plain')).rejects.toThrow();
    await expect(storage.get('k')).rejects.toThrow();
    await expect(storage.remove('k')).rejects.toThrow();
    await expect(storage.ping()).rejects.toThrow();
  });

  it('peek отдаёт сохранённый объект с content-type для проверок в тестах', async () => {
    const storage = new FakeObjectStorage();
    await storage.put('k', Buffer.from('x'), 'image/webp');

    expect(storage.peek('k')).toMatchObject({ contentType: 'image/webp' });
  });
});
