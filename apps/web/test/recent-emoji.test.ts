import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_RECENT_EMOJI,
  addRecentEmoji,
  getRecentEmoji,
} from '../src/features/emoji/infrastructure/recent-emoji';

describe('recent-emoji', () => {
  beforeEach(() => localStorage.clear());

  it('изначально показывает дефолтный набор для контекста покер-планирования', () => {
    expect(getRecentEmoji()).toEqual([...DEFAULT_RECENT_EMOJI]);
  });

  it('повторный вызов отдаёт тот же дефолтный набор (не пересеивает заново каждый раз)', () => {
    const first = getRecentEmoji();
    const second = getRecentEmoji();
    expect(second).toEqual(first);
  });

  it('добавляет новое эмодзи в начало дефолтного набора', () => {
    addRecentEmoji('🚀');
    expect(getRecentEmoji()).toEqual(['🚀', ...DEFAULT_RECENT_EMOJI]);
  });

  it('дедупликация при повторном добавлении дефолтного эмодзи — поднимает его наверх', () => {
    const targetDefault = DEFAULT_RECENT_EMOJI[3]!;
    addRecentEmoji(targetDefault);
    const result = getRecentEmoji();
    expect(result[0]).toBe(targetDefault);
    expect(result).toHaveLength(DEFAULT_RECENT_EMOJI.length);
  });

  it('реальные выборы пользователя постепенно вытесняют дефолты за пределы MAX_RECENT', () => {
    // Дефолтов 12, кап — 24: пока новых меньше (24 - 12), дефолты ещё держатся
    // в хвосте списка, вытесняться начинают только после заполнения кап целиком.
    for (let i = 0; i < DEFAULT_RECENT_EMOJI.length; i++) {
      addRecentEmoji(`emoji-${i}`);
    }
    expect(getRecentEmoji()).toEqual(expect.arrayContaining([...DEFAULT_RECENT_EMOJI]));

    // Ещё столько же новых эмодзи — кап переполняется, и все дефолты как
    // самые старые записи вытесняются первыми.
    for (let i = DEFAULT_RECENT_EMOJI.length; i < DEFAULT_RECENT_EMOJI.length * 2; i++) {
      addRecentEmoji(`emoji-${i}`);
    }
    const result = getRecentEmoji();
    for (const def of DEFAULT_RECENT_EMOJI) {
      expect(result).not.toContain(def);
    }
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
