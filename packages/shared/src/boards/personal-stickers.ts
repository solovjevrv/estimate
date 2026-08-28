/**
 * Типы для личных стикер-паков (21.6): импорт публичных Telegram-паков через Bot API.
 * Совпадают с интерфейсами на фронте (§5.2) — импортируются из @estimate/shared.
 */

/**
 * 'static' — WebP (21.6). 'animated' — Telegram TGS/Lottie, распакован из gzip
 * и хранится как обычный JSON, рендерится LottieSticker.vue. 'video' — WebM,
 * рендерится тегом <video> (оба — 21.7).
 */
export type PersonalStickerFormat = 'static' | 'animated' | 'video';
export const PERSONAL_STICKER_FORMATS: readonly PersonalStickerFormat[] = [
  'static',
  'animated',
  'video',
];

export interface PersonalStickerSummary {
  id: string;
  /** Emoji, которым Telegram промаркировал стикер — alt/aria-label */
  emoji: string;
  format: PersonalStickerFormat;
}

export interface PersonalStickerPackSummary {
  id: string;
  /** title из Telegram — человекочитаемое название пака */
  title: string;
  /** short_name из Telegram */
  telegramSetName: string;
  stickers: PersonalStickerSummary[];
}

/** Пак с метаданными стикеров — тот же shape, что и PersonalStickerPackSummary */
export type PersonalStickerPackWithStickers = PersonalStickerPackSummary;
