import type { SkinToneId } from '@estimate/shared';

const STORAGE_KEY = 'estimate-emoji-skin-tone';

export const SKIN_TONES: readonly { id: SkinToneId; swatch: string }[] = [
  { id: 'light', swatch: '#F7DECE' },
  { id: 'medium-light', swatch: '#F1C27D' },
  { id: 'medium', swatch: '#E0AC69' },
  { id: 'medium-dark', swatch: '#C68642' },
  { id: 'dark', swatch: '#8D5524' },
];

/**
 * Глобальное (не per-эмодзи) предпочтение тона кожи, применяется
 * автоматически ко всем эмодзи, у которых есть skins (для остальных — без
 * изменений). Сохраняется в localStorage между сессиями.
 */
export function getPreferredSkinTone(): SkinToneId | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return SKIN_TONES.some((t) => t.id === raw) ? (raw as SkinToneId) : null;
  } catch {
    return null;
  }
}

export function setPreferredSkinTone(tone: SkinToneId | null): void {
  try {
    if (tone) localStorage.setItem(STORAGE_KEY, tone);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
