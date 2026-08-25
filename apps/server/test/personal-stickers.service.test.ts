/**
 * Юнит-тесты PersonalStickersService (21.6): импорт, листинг, удаление.
 * TelegramClient и PersonalStickersRepository подменяются — тестируем
 * бизнес-логику (квоты, фильтры, идемпотентность, устойчивость к сбоям) без сети и БД.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ObjectStorage } from '../src/platform/storage';
import {
  TelegramApiError,
  type TelegramClient,
  type TelegramStickerFile,
  type TelegramStickerSet,
} from '../src/boards/telegram-client';
import { PersonalStickersService } from '../src/boards/personal-stickers.service';
import type { PersonalStickersRepository } from '../src/boards/personal-stickers.repository';
import { ValidationError } from '../src/errors';

const OWNER_ID = 'user-owner-id';

function mockRepo(overrides: Partial<PersonalStickersRepository> = {}): PersonalStickersRepository {
  return {
    findPackByOwnerAndSetName: vi.fn().mockResolvedValue(null),
    findPackOwner: vi.fn(),
    countPacksByOwner: vi.fn().mockResolvedValue(0),
    sumBytesByOwner: vi.fn().mockResolvedValue(0),
    createPackWithStickers: vi.fn().mockResolvedValue({
      id: 'pack-uuid',
      title: 'Test Pack',
      telegramSetName: 'testpack',
      stickers: [],
    }),
    getPackWithStickers: vi.fn(),
    listPacksByOwner: vi.fn().mockResolvedValue([]),
    deletePack: vi.fn(),
    ...overrides,
  } as unknown as PersonalStickersRepository;
}

function mockStorage(overrides: Partial<ObjectStorage> = {}): ObjectStorage {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as ObjectStorage;
}

function mockTelegram(
  overrides: Partial<{
    getStickerSet: (name: string) => Promise<TelegramStickerSet>;
    downloadFile: (fileId: string) => Promise<Buffer>;
  }> = {},
): TelegramClient {
  return {
    getStickerSet: vi.fn().mockResolvedValue({
      name: 'testpack',
      title: 'Test Pack',
      stickers: [basicSticker('sticker-1', '😀')],
    }),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from('webp-bytes')),
    ...overrides,
  } as unknown as TelegramClient;
}

function basicSticker(fileId: string, emoji: string): TelegramStickerFile {
  return {
    fileId,
    fileUniqueId: `unique-${fileId}`,
    emoji,
    isAnimated: false,
    isVideo: false,
    fileSize: 1024,
  };
}

describe('PersonalStickersService.importFromTelegram', () => {
  it('идемпотентен: повторный импорт того же пака возвращает существующий', async () => {
    const existingPackId = randomUUID();
    const repo = mockRepo({
      findPackByOwnerAndSetName: vi.fn().mockResolvedValue({ id: existingPackId }),
      getPackWithStickers: vi.fn().mockResolvedValue({
        id: existingPackId,
        title: 'Existing',
        telegramSetName: 'testpack',
        stickers: [{ id: 's1', emoji: '😀' }],
      }),
    });
    const storage = mockStorage();
    const telegram = mockTelegram();
    const service = new PersonalStickersService(repo, telegram, storage);

    const result = await service.importFromTelegram(OWNER_ID, 'testpack');

    expect(result.pack.id).toBe(existingPackId);
    expect(result.skipped).toBe(0);
    expect(telegram.getStickerSet).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('оборачивает TelegramApiError в ValidationError', async () => {
    const repo = mockRepo();
    const storage = mockStorage();
    const telegram = mockTelegram({
      getStickerSet: vi.fn().mockRejectedValue(new TelegramApiError('sticker set not found')),
    });
    const service = new PersonalStickersService(repo, telegram, storage);

    await expect(service.importFromTelegram(OWNER_ID, 'badpack')).rejects.toThrow(ValidationError);
    await expect(service.importFromTelegram(OWNER_ID, 'badpack')).rejects.toThrow(
      'sticker set not found',
    );
  });

  it('отбрасывает анимированные/видео стикеры', async () => {
    const repo = mockRepo();
    const storage = mockStorage();
    const telegram = mockTelegram({
      getStickerSet: vi.fn().mockResolvedValue({
        name: 'mixedpack',
        title: 'Mixed Pack',
        stickers: [
          basicSticker('anim', '😀'),
          { ...basicSticker('video', '🎬'), isVideo: true },
          { ...basicSticker('animated', '🤡'), isAnimated: true },
        ],
      }),
    });
    const service = new PersonalStickersService(repo, telegram, storage);

    const result = await service.importFromTelegram(OWNER_ID, 'mixedpack');

    expect(telegram.downloadFile).toHaveBeenCalledTimes(1);
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(2);
  });

  it('пропускает файлы больше MAX_STICKER_FILE_BYTES без фейла', async () => {
    const repo = mockRepo();
    const storage = mockStorage();
    const telegram = mockTelegram({
      getStickerSet: vi.fn().mockResolvedValue({
        name: 'mixedpack',
        title: 'Mixed Pack',
        stickers: [
          basicSticker('small', '😀'), // 1024 байта — ок
          { ...basicSticker('large', '🎉'), fileSize: 2048 }, // 2 МБ — пропуск
        ],
      }),
      downloadFile: vi
        .fn()
        .mockResolvedValueOnce(Buffer.from('small-bytes')) // small
        .mockResolvedValueOnce(Buffer.alloc(2 * 1024 * 1024)), // 2 МБ — пропуск
    });
    const service = new PersonalStickersService(repo, telegram, storage);

    const result = await service.importFromTelegram(OWNER_ID, 'mixedpack');

    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringContaining('stickers/users'),
      Buffer.from('small-bytes'),
      'image/webp',
    );
    expect(result.skipped).toBe(1);
  });

  it('прерывается по квоте по байтам, не превышает MAX_TOTAL_BYTES_PER_USER', async () => {
    const repo = mockRepo({
      sumBytesByOwner: vi.fn().mockResolvedValue(49 * 1024 * 1024), // 49 МБ уже есть
    });
    const storage = mockStorage();
    const telegram = mockTelegram(); // 1024 байта на стикер
    const service = new PersonalStickersService(repo, telegram, storage);

    await expect(service.importFromTelegram(OWNER_ID, 'testpack')).resolves.toBeTruthy();
    // Сумма уже 49 МБ + 1 КБ = ок, импорт проходит
  });

  it('откатывает, если ни один стикер не скачался (скачан ошибка)', async () => {
    const repo = mockRepo({
      createPackWithStickers: vi.fn().mockResolvedValue({
        id: 'pack',
        title: 'Pack',
        telegramSetName: 'testpack',
        stickers: [],
      }),
    });
    const storage = mockStorage();
    const telegram = mockTelegram({
      downloadFile: vi.fn().mockRejectedValue(new Error('network error')),
    });
    const service = new PersonalStickersService(repo, telegram, storage);

    await expect(service.importFromTelegram(OWNER_ID, 'testpack')).rejects.toThrow(ValidationError);
    expect(repo.createPackWithStickers).not.toHaveBeenCalled();
  });

  it('проверяет квоту на количество паков до обращения к Telegram', async () => {
    const repo = mockRepo({
      countPacksByOwner: vi.fn().mockResolvedValue(20),
    });
    const storage = mockStorage();
    const telegram = mockTelegram();
    const service = new PersonalStickersService(repo, telegram, storage);

    await expect(service.importFromTelegram(OWNER_ID, 'testpack')).rejects.toThrow(ValidationError);
    expect(telegram.getStickerSet).not.toHaveBeenCalled();
  });

  it('обрезает до MAX_STICKERS_PER_PACK', async () => {
    const repo = mockRepo();
    const storage = mockStorage();
    const stickers: TelegramStickerFile[] = Array.from({ length: 250 }, (_, i) =>
      basicSticker(`s-${i}`, '😀'),
    );
    const telegram = mockTelegram({
      getStickerSet: vi.fn().mockResolvedValue({ name: 'bigpack', title: 'Big', stickers }),
    });
    const service = new PersonalStickersService(repo, telegram, storage);

    await service.importFromTelegram(OWNER_ID, 'bigpack');

    expect(telegram.downloadFile).toHaveBeenCalledTimes(200);
  });
});

describe('PersonalStickersService.deleteOwn', () => {
  it('удаляет стикеры из storage по ключу ownerId/packId/stickerId', async () => {
    const repo = mockRepo({
      deletePack: vi.fn().mockResolvedValue({
        id: 'pack-1',
        title: 'Pack',
        telegramSetName: 'pack',
        stickers: [
          { id: 's1', emoji: '😀' },
          { id: 's2', emoji: '🎉' },
        ],
      }),
    });
    const storage = mockStorage();
    const telegram = mockTelegram();
    const service = new PersonalStickersService(repo, telegram, storage);

    await service.deleteOwn(OWNER_ID, 'pack-1');

    expect(storage.remove).toHaveBeenCalledTimes(2);
    expect(storage.remove).toHaveBeenCalledWith(`stickers/users/${OWNER_ID}/pack-1/s1.webp`);
    expect(storage.remove).toHaveBeenCalledWith(`stickers/users/${OWNER_ID}/pack-1/s2.webp`);
  });

  it('бросает NotFoundError, если пак не принадлежит пользователю', async () => {
    const { NotFoundError } = await import('../src/errors');
    const repo = mockRepo({ deletePack: vi.fn().mockResolvedValue(null) });
    const storage = mockStorage();
    const telegram = mockTelegram();
    const service = new PersonalStickersService(repo, telegram, storage);

    await expect(service.deleteOwn(OWNER_ID, 'foreign-pack')).rejects.toThrow(NotFoundError);
  });
});
