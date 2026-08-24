import { beforeEach, describe, expect, it } from 'vitest';

import { addRecentEmoji, getRecentEmoji } from '../src/features/emoji/infrastructure/recent-emoji';

describe('recent-emoji', () => {
  beforeEach(() => localStorage.clear());

  it('изначально пусто', () => {
    expect(getRecentEmoji()).toEqual([]);
  });

  it('добавляет эмодзи в начало списка', () => {
    addRecentEmoji('👍');
    addRecentEmoji('🔥');
    expect(getRecentEmoji()).toEqual(['🔥', '👍']);
  });

  it('дедупликация при повторном добавлении — поднимает существующий наверх', () => {
    addRecentEmoji('👍');
    addRecentEmoji('🔥');
    addRecentEmoji('👍');
    expect(getRecentEmoji()).toEqual(['👍', '🔥']);
  });

  it('ограничивает список 24 записями, вытесняя самый старый', () => {
    for (let i = 0; i < 25; i++) {
      addRecentEmoji(`emoji-${i}`);
    }
    const result = getRecentEmoji();
    expect(result).toHaveLength(24);
    expect(result[0]).toBe('emoji-24'); // самый новый — первым
    expect(result).not.toContain('emoji-0'); // самый первый — вытеснен
  });
});
