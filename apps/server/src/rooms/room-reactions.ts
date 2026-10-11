import type { EmojiSequence, Reaction } from '@estimate/shared';

import { MemoryRealtimeStore, type RealtimeStore } from '../platform/realtime';

/**
 * Реакции-эмодзи на карточках участников (10.10). Сиюминутное состояние стола,
 * а не история: живут в `RealtimeStore` (10.18) — в памяти процесса или в
 * Redis, общем для экземпляров сервера, — и сбрасываются с новым раундом.
 *
 * Хэш на комнату, поле — пара «от кого → кому»: реакции разных людей правятся
 * независимыми полями и не затирают друг друга при одновременной отправке с
 * разных экземпляров.
 */
export class RoomReactions {
  constructor(private readonly store: RealtimeStore = new MemoryRealtimeStore()) {}

  /** Снимок реакций комнаты; пустой массив, если ни одной ещё не было */
  async list(roomId: string): Promise<Reaction[]> {
    const fields = await this.store.hashGetAll(this.key(roomId));
    return fields.map(([, value]) => JSON.parse(value) as Reaction);
  }

  /**
   * Реакцию можно менять в любой момент раунда — новая от того же автора
   * тому же адресату заменяет предыдущую, а не добавляется второй записью.
   * Повторная присылка уже стоящей реакции (клик по своему же бейджу в UI)
   * снимает её — как реакции на сообщение в Telegram.
   */
  async toggle(roomId: string, from: string, to: string, emoji: EmojiSequence): Promise<void> {
    const key = this.key(roomId);
    const field = `${from}\n${to}`;
    const existing = await this.store.hashGet(key, field);
    if (existing && (JSON.parse(existing) as Reaction).emoji === emoji) {
      await this.store.hashDelete(key, field);
      return;
    }
    const reaction: Reaction = { fromParticipantId: from, toParticipantId: to, emoji };
    await this.store.hashSet(key, field, JSON.stringify(reaction));
  }

  /** Комната опустела или начался новый раунд — сиюминутное состояние ей больше не нужно */
  async clear(roomId: string): Promise<void> {
    await this.store.delete(this.key(roomId));
  }

  private key(roomId: string): string {
    return `room-reactions:${roomId}`;
  }
}
