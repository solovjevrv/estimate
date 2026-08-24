/**
 * Стор личных стикер-паков (21.6): кэширует список импортированных пользователем
 * паков. Инвалидируется только после импорта/удаления в этом же сторе.
 * Используется в BoardStickerPicker.vue (секция «Мои паки») и в BoardStickerNode.vue
 * (чтобы понять, есть ли у смотрящего этот пак — §5.5).
 */
import type { PersonalStickerPackSummary } from '@poker/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { ApiError } from '../lib/api';
import {
  deleteStickerPack,
  importStickerPack,
  listMyStickerPacks,
} from '../features/boards/api/personal-stickers-api';

export const usePersonalStickerPacksStore = defineStore('personal-sticker-packs', () => {
  const packs = ref<PersonalStickerPackSummary[]>([]);
  const loaded = ref(false);
  let pending: Promise<void> | null = null;

  async function load(): Promise<void> {
    if (loaded.value) return;
    pending ??= listMyStickerPacks()
      .then((result) => {
        packs.value = result;
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          // Фича выключена на сервере (без TELEGRAM_BOT_TOKEN) — паки пусты
          packs.value = [];
        } else {
          console.warn('Не удалось загрузить личные стикер-паки', err);
          packs.value = [];
        }
      })
      .finally(() => {
        loaded.value = true;
        pending = null;
      });
    await pending;
  }

  async function importPack(telegramSetName: string): Promise<PersonalStickerPackSummary> {
    const result = await importStickerPack(telegramSetName);
    const existingIndex = packs.value.findIndex((p) => p.id === result.pack.id);
    if (existingIndex >= 0) {
      packs.value.splice(existingIndex, 1, result.pack);
    } else {
      packs.value.push(result.pack);
    }
    return result.pack;
  }

  async function deletePack(packId: string): Promise<void> {
    await deleteStickerPack(packId);
    packs.value = packs.value.filter((p) => p.id !== packId);
  }

  function hasPack(packId: string): boolean {
    return packs.value.some((p) => p.id === packId);
  }

  return { packs, loaded, load, importPack, deletePack, hasPack };
});
