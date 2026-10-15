/**
 * Юнит-тесты реакций-эмодзи на карточках участников (10.10): чистая логика
 * без БД и сокетов.
 */
import { describe, expect, it } from 'vitest';

import { RoomReactions } from '../src/rooms/room-reactions';

const ROOM = 'room-1';

describe('RoomReactions', () => {
  it('до первой реакции список пуст', async () => {
    const reactions = new RoomReactions();

    expect(await reactions.list(ROOM)).toEqual([]);
  });

  it('реакция добавляется и видна в списке', async () => {
    const reactions = new RoomReactions();

    await reactions.toggle(ROOM, 'u1', 'u2', '👍');
    const result = await reactions.list(ROOM);

    expect(result).toEqual([{ fromParticipantId: 'u1', toParticipantId: 'u2', emoji: '👍' }]);
  });

  it('реакция другим эмодзи от того же автора тому же адресату заменяет предыдущую', async () => {
    const reactions = new RoomReactions();
    await reactions.toggle(ROOM, 'u1', 'u2', '👍');

    await reactions.toggle(ROOM, 'u1', 'u2', '😂');
    const result = await reactions.list(ROOM);

    expect(result).toEqual([{ fromParticipantId: 'u1', toParticipantId: 'u2', emoji: '😂' }]);
  });

  it('повторная присылка уже стоящей реакции снимает её (клик по своему бейджу)', async () => {
    const reactions = new RoomReactions();
    await reactions.toggle(ROOM, 'u1', 'u2', '👍');

    await reactions.toggle(ROOM, 'u1', 'u2', '👍');
    const result = await reactions.list(ROOM);

    expect(result).toEqual([]);
  });

  it('снятая реакция не мешает поставить её заново', async () => {
    const reactions = new RoomReactions();
    await reactions.toggle(ROOM, 'u1', 'u2', '👍');
    await reactions.toggle(ROOM, 'u1', 'u2', '👍'); // сняли

    await reactions.toggle(ROOM, 'u1', 'u2', '👍');
    const result = await reactions.list(ROOM);

    expect(result).toEqual([{ fromParticipantId: 'u1', toParticipantId: 'u2', emoji: '👍' }]);
  });

  it('реакции разных авторов одному адресату сосуществуют', async () => {
    const reactions = new RoomReactions();
    await reactions.toggle(ROOM, 'u1', 'u3', '👍');

    await reactions.toggle(ROOM, 'u2', 'u3', '😢');
    const result = await reactions.list(ROOM);

    expect(result).toEqual([
      { fromParticipantId: 'u1', toParticipantId: 'u3', emoji: '👍' },
      { fromParticipantId: 'u2', toParticipantId: 'u3', emoji: '😢' },
    ]);
  });

  it('реакции одного автора разным адресатам сосуществуют', async () => {
    const reactions = new RoomReactions();
    await reactions.toggle(ROOM, 'u1', 'u2', '👍');

    await reactions.toggle(ROOM, 'u1', 'u3', '😢');
    const result = await reactions.list(ROOM);

    expect(result).toEqual([
      { fromParticipantId: 'u1', toParticipantId: 'u2', emoji: '👍' },
      { fromParticipantId: 'u1', toParticipantId: 'u3', emoji: '😢' },
    ]);
  });

  it('clear убирает все реакции комнаты', async () => {
    const reactions = new RoomReactions();
    await reactions.toggle(ROOM, 'u1', 'u2', '👍');

    await reactions.clear(ROOM);

    expect(await reactions.list(ROOM)).toEqual([]);
  });

  it('реакции разных комнат не пересекаются', async () => {
    const reactions = new RoomReactions();
    await reactions.toggle(ROOM, 'u1', 'u2', '👍');

    expect(await reactions.list('другая-комната')).toEqual([]);
  });
});
