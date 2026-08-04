/**
 * Юнит-тесты реакций-эмодзи на карточках участников (10.10): чистая логика
 * без БД и сокетов.
 */
import { describe, expect, it } from 'vitest';

import { RoomReactions } from '../src/rooms/room-reactions';

const ROOM = 'room-1';

describe('RoomReactions', () => {
  it('до первой реакции список пуст', () => {
    const reactions = new RoomReactions();

    expect(reactions.list(ROOM)).toEqual([]);
  });

  it('реакция добавляется и видна в списке', () => {
    const reactions = new RoomReactions();

    const result = reactions.toggle(ROOM, 'u1', 'u2', '👍');

    expect(result).toEqual([{ fromParticipantId: 'u1', toParticipantId: 'u2', emoji: '👍' }]);
  });

  it('реакция другим эмодзи от того же автора тому же адресату заменяет предыдущую', () => {
    const reactions = new RoomReactions();
    reactions.toggle(ROOM, 'u1', 'u2', '👍');

    const result = reactions.toggle(ROOM, 'u1', 'u2', '😂');

    expect(result).toEqual([{ fromParticipantId: 'u1', toParticipantId: 'u2', emoji: '😂' }]);
  });

  it('повторная присылка уже стоящей реакции снимает её (клик по своему бейджу)', () => {
    const reactions = new RoomReactions();
    reactions.toggle(ROOM, 'u1', 'u2', '👍');

    const result = reactions.toggle(ROOM, 'u1', 'u2', '👍');

    expect(result).toEqual([]);
  });

  it('снятая реакция не мешает поставить её заново', () => {
    const reactions = new RoomReactions();
    reactions.toggle(ROOM, 'u1', 'u2', '👍');
    reactions.toggle(ROOM, 'u1', 'u2', '👍'); // сняли

    const result = reactions.toggle(ROOM, 'u1', 'u2', '👍');

    expect(result).toEqual([{ fromParticipantId: 'u1', toParticipantId: 'u2', emoji: '👍' }]);
  });

  it('реакции разных авторов одному адресату сосуществуют', () => {
    const reactions = new RoomReactions();
    reactions.toggle(ROOM, 'u1', 'u3', '👍');

    const result = reactions.toggle(ROOM, 'u2', 'u3', '😢');

    expect(result).toEqual([
      { fromParticipantId: 'u1', toParticipantId: 'u3', emoji: '👍' },
      { fromParticipantId: 'u2', toParticipantId: 'u3', emoji: '😢' },
    ]);
  });

  it('реакции одного автора разным адресатам сосуществуют', () => {
    const reactions = new RoomReactions();
    reactions.toggle(ROOM, 'u1', 'u2', '👍');

    const result = reactions.toggle(ROOM, 'u1', 'u3', '😢');

    expect(result).toEqual([
      { fromParticipantId: 'u1', toParticipantId: 'u2', emoji: '👍' },
      { fromParticipantId: 'u1', toParticipantId: 'u3', emoji: '😢' },
    ]);
  });

  it('clear убирает все реакции комнаты', () => {
    const reactions = new RoomReactions();
    reactions.toggle(ROOM, 'u1', 'u2', '👍');

    reactions.clear(ROOM);

    expect(reactions.list(ROOM)).toEqual([]);
  });

  it('реакции разных комнат не пересекаются', () => {
    const reactions = new RoomReactions();
    reactions.toggle(ROOM, 'u1', 'u2', '👍');

    expect(reactions.list('другая-комната')).toEqual([]);
  });
});
