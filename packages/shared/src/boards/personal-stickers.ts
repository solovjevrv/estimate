/**
 * Типы для личных стикер-паков (21.6): импорт публичных Telegram-паков через Bot API.
 * Совпадают с интерфейсами на фронте (§5.2) — импортируются из @poker/shared.
 */

export interface PersonalStickerSummary {
  id: string;
  /** Emoji, которым Telegram промаркировал стикер — alt/aria-label */
  emoji: string;
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
