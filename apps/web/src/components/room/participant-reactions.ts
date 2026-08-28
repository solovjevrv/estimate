import type { EmojiSequence } from '@estimate/shared';

/**
 * Одна и та же реакция от нескольких участников схлопнута в одну запись со
 * счётчиком (как реакции на сообщение в Telegram) — иначе бейджи не
 * помещались бы под карточкой при десятке участников.
 */
export interface ReceivedReaction {
  emoji: EmojiSequence;
  count: number;
  /** Имена отправителей — для подсказки при наведении */
  fromNames: string[];
  /** Среди отправителей — сам смотрящий: клик по бейджу снимет реакцию, а не добавит вторую */
  reactedByMe: boolean;
}

/** Одноразовый «вылет» эмодзи над карточкой в момент простановки реакции (10.12, Meet-style) */
export interface FlyingReaction {
  id: string;
  emoji: EmojiSequence;
}
