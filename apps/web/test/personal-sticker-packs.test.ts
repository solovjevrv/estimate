/**
 * Тесты Pinia-стора personal-sticker-packs (21.6):
 * load (кеширует, один запрос), importPack (добавление/обновление), deletePack (удаление).
 * API-клиент подменяется через vi.mock.
 */
import { randomUUID } from 'node:crypto';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersonalStickerPackSummary } from '@poker/shared';

import { ApiError } from '../src/lib/api';

const mockApi = vi.hoisted(() => ({
  listMyStickerPacks: vi.fn(),
  getStickerPackMeta: vi.fn(),
  importStickerPack: vi.fn(),
  deleteStickerPack: vi.fn(),
}));

vi.mock('../src/features/boards/api/personal-stickers-api', () => mockApi);

const PACK: PersonalStickerPackSummary = {
  id: randomUUID(),
  title: 'Test Pack',
  telegramSetName: 'testpack',
  stickers: [{ id: 's1', emoji: '😀' }],
};

describe('usePersonalStickerPacksStore', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockApi.listMyStickerPacks.mockReset();
    mockApi.importStickerPack.mockReset();
    mockApi.deleteStickerPack.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('load кеширует результат — второй вызов не дублирует запрос', async () => {
    mockApi.listMyStickerPacks.mockResolvedValue([PACK]);
    const { usePersonalStickerPacksStore } = await import('../src/stores/personal-sticker-packs');
    const store = usePersonalStickerPacksStore();

    await store.load();
    expect(store.packs).toHaveLength(1);
    expect(store.packs[0]?.title).toBe('Test Pack');

    await store.load();
    expect(mockApi.listMyStickerPacks).toHaveBeenCalledTimes(1);
  });

  it('importPack добавляет новый пак в список', async () => {
    mockApi.listMyStickerPacks.mockResolvedValue([]);
    mockApi.importStickerPack.mockResolvedValue({ pack: PACK, skipped: 0 });
    const { usePersonalStickerPacksStore } = await import('../src/stores/personal-sticker-packs');
    const store = usePersonalStickerPacksStore();
    await store.load();

    const result = await store.importPack('testpack');
    expect(result.id).toBe(PACK.id);
    expect(store.packs).toHaveLength(1);
    expect(store.packs[0]?.title).toBe('Test Pack');
  });

  it('importPack обновляет существующий пак по id', async () => {
    mockApi.listMyStickerPacks.mockResolvedValue([PACK]);
    const updated = { ...PACK, title: 'Updated' };
    mockApi.importStickerPack.mockResolvedValue({ pack: updated, skipped: 0 });
    const { usePersonalStickerPacksStore } = await import('../src/stores/personal-sticker-packs');
    const store = usePersonalStickerPacksStore();
    await store.load();

    await store.importPack('testpack');
    expect(store.packs).toHaveLength(1);
    expect(store.packs[0]?.title).toBe('Updated');
  });

  it('deletePack удаляет пак из списка', async () => {
    mockApi.listMyStickerPacks.mockResolvedValue([PACK]);
    mockApi.deleteStickerPack.mockResolvedValue(undefined);
    const { usePersonalStickerPacksStore } = await import('../src/stores/personal-sticker-packs');
    const store = usePersonalStickerPacksStore();
    await store.load();

    await store.deletePack(PACK.id);
    expect(store.packs).toHaveLength(0);
    expect(mockApi.deleteStickerPack).toHaveBeenCalledWith(PACK.id);
  });

  it('hasPack возвращает true для импортированного пака', async () => {
    mockApi.listMyStickerPacks.mockResolvedValue([PACK]);
    const { usePersonalStickerPacksStore } = await import('../src/stores/personal-sticker-packs');
    const store = usePersonalStickerPacksStore();
    await store.load();

    expect(store.hasPack(PACK.id)).toBe(true);
    expect(store.hasPack(randomUUID())).toBe(false);
  });

  it('load не падает при 404 и помечает фичу выключенной (нет TELEGRAM_BOT_TOKEN)', async () => {
    mockApi.listMyStickerPacks.mockRejectedValue(new ApiError(404, 'not_found', 'not found'));
    const { usePersonalStickerPacksStore } = await import('../src/stores/personal-sticker-packs');
    const store = usePersonalStickerPacksStore();

    expect(store.enabled).toBe(true);
    await expect(store.load()).resolves.not.toThrow();
    expect(store.packs).toHaveLength(0);
    expect(store.enabled).toBe(false);
  });

  it('load оставляет enabled=true при обычной сетевой ошибке (не 404)', async () => {
    mockApi.listMyStickerPacks.mockRejectedValue(new Error('network down'));
    const { usePersonalStickerPacksStore } = await import('../src/stores/personal-sticker-packs');
    const store = usePersonalStickerPacksStore();

    await expect(store.load()).resolves.not.toThrow();
    expect(store.enabled).toBe(true);
  });
});
