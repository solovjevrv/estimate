/**
 * «Недавние» стикеры в пикере (13.4, редизайн под референс Miro) — без БД
 * (задача явно этого не предполагает), поэтому история живёт в localStorage
 * браузера: своя на каждом устройстве, переживает перезагрузку страницы.
 */

const STORAGE_KEY = 'poker-board-recent-stickers';
const MAX_RECENT = 12;

export interface RecentStickerRef {
  pack: string;
  id: string;
}

function isRecentStickerRef(value: unknown): value is RecentStickerRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RecentStickerRef).pack === 'string' &&
    typeof (value as RecentStickerRef).id === 'string'
  );
}

export function getRecentStickers(): RecentStickerRef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentStickerRef);
  } catch {
    return [];
  }
}

/** Приватный режим/заполненная квота — история недавних не критична, просто пропускаем */
export function addRecentSticker(pack: string, id: string): void {
  try {
    const withoutDuplicate = getRecentStickers().filter(
      (ref) => !(ref.pack === pack && ref.id === id),
    );
    const next = [{ pack, id }, ...withoutDuplicate].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // no-op
  }
}
