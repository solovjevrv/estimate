import type { Reaction, ReactionEmoji } from '@poker/shared';

/**
 * Реакции-эмодзи на карточках участников (10.10). Живут в памяти процесса на
 * комнату — как таймер (`RoomTimer`) и присутствие, а не в базе: сиюминутное
 * состояние стола, сбрасывается с новым раундом. При нескольких инстансах
 * сюда тоже понадобится общий адаптер (см. Epic 8/7.12).
 */
export class RoomReactions {
  private readonly byRoom = new Map<string, Reaction[]>();

  /** Снимок реакций комнаты; пустой массив, если ни одной ещё не было */
  list(roomId: string): Reaction[] {
    return this.byRoom.get(roomId) ?? [];
  }

  /**
   * Реакцию можно менять в любой момент раунда — новая от того же автора
   * тому же адресату заменяет предыдущую, а не добавляется второй записью.
   * Повторная присылка уже стоящей реакции (клик по своему же бейджу в UI)
   * снимает её — как реакции на сообщение в Telegram.
   */
  toggle(roomId: string, from: string, to: string, emoji: ReactionEmoji): Reaction[] {
    const current = this.list(roomId);
    const existing = current.find((r) => r.fromParticipantId === from && r.toParticipantId === to);
    const withoutExisting = current.filter(
      (r) => !(r.fromParticipantId === from && r.toParticipantId === to),
    );
    const next =
      existing?.emoji === emoji
        ? withoutExisting
        : [...withoutExisting, { fromParticipantId: from, toParticipantId: to, emoji }];
    this.byRoom.set(roomId, next);
    return next;
  }

  /** Комната опустела или начался новый раунд — сиюминутное состояние ей больше не нужно */
  clear(roomId: string): void {
    this.byRoom.delete(roomId);
  }
}
