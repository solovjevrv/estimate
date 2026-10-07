import { ROOM_NAME_MAX_LENGTH } from '@estimate/shared';
import { describe, expect, it } from 'vitest';

import { estimateLabel, estimateRoomName } from '../src/boards/board-estimates';

describe('estimateLabel (15.6)', () => {
  it('среднее — к ближайшей карте колоды', () => {
    expect(estimateLabel('fibonacci', 7.5, [])).toBe('8');
    expect(estimateLabel('fibonacci', 6, [])).toBe('5');
    expect(estimateLabel('scale_0_5', 0.4, [])).toBe('0');
  });

  it('ровно посередине — большая карта: недооценить хуже', () => {
    expect(estimateLabel('fibonacci', 4, [])).toBe('5');
    expect(estimateLabel('fibonacci', 10.5, [])).toBe('13');
  });

  it('без зафиксированного среднего — считается по голосам; голосов нет — null', () => {
    expect(estimateLabel('fibonacci', null, [3, 5, 8])).toBe('5');
    expect(estimateLabel('fibonacci', null, [])).toBeNull();
  });

  it('футболки — самый частый размер, при равенстве — больший', () => {
    expect(estimateLabel('tshirt', null, [3, 3, 5])).toBe('M');
    expect(estimateLabel('tshirt', null, [2, 5])).toBe('L');
    expect(estimateLabel('tshirt', null, [])).toBeNull();
  });
});

describe('estimateRoomName (15.6)', () => {
  it('текст элемента одной строкой', () => {
    expect(estimateRoomName('  Экспорт\nдоски   в PDF ', 'Задача')).toBe('Экспорт доски в PDF');
  });

  it('пустой текст — запасное название', () => {
    expect(estimateRoomName(' \n ', 'Задача с доски')).toBe('Задача с доски');
  });

  it('длинный текст обрезается до лимита комнаты с многоточием', () => {
    const name = estimateRoomName('а'.repeat(ROOM_NAME_MAX_LENGTH + 10), 'Задача');
    expect(Array.from(name)).toHaveLength(ROOM_NAME_MAX_LENGTH);
    expect(name.endsWith('…')).toBe(true);
  });
});
