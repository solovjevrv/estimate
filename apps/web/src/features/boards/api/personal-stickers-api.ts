/** REST-слой личных стикеров: единственное место, знающее URL `/api/sticker-packs/personal/*`. */
import type { PersonalStickerPackSummary } from '@poker/shared';

import { api } from '../../../lib/api';

export function listMyStickerPacks(): Promise<PersonalStickerPackSummary[]> {
  return api
    .get<{ packs: PersonalStickerPackSummary[] }>('/api/sticker-packs/personal')
    .then((res) => res.packs);
}

export function getStickerPackMeta(packId: string): Promise<PersonalStickerPackSummary> {
  return api
    .get<{ pack: PersonalStickerPackSummary }>(
      `/api/sticker-packs/personal/${encodeURIComponent(packId)}`,
    )
    .then((res) => res.pack);
}

export function importStickerPack(
  telegramSetName: string,
): Promise<{ pack: PersonalStickerPackSummary; skipped: number }> {
  return api
    .post<{ pack: PersonalStickerPackSummary; skipped: number }>(
      '/api/sticker-packs/personal/import',
      { telegramSetName },
    )
    .then((res) => ({ pack: res.pack, skipped: res.skipped }));
}

export function deleteStickerPack(packId: string): Promise<void> {
  return api.delete(`/api/sticker-packs/personal/${encodeURIComponent(packId)}`);
}

/**
 * Вырезает short_name из вставленной ссылки t.me/addstickers/:name
 * или принимает голое имя (буквы/цифры/подчёркивания).
 * Возвращает null, если строка не подходит под формат.
 */
export function parseTelegramSetName(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/(?:t\.me\/addstickers\/|^)([A-Za-z0-9_]+)\/?$/);
  return match ? match[1]! : null;
}
