import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRecentColor,
  getRecentColors,
} from '../src/features/boards/infrastructure/recent-colors';

describe('recent-colors', () => {
  beforeEach(() => localStorage.clear());

  it('изначально пусто', () => {
    expect(getRecentColors()).toEqual([]);
  });

  it('добавляет цвет в начало списка', () => {
    addRecentColor('#123456');
    addRecentColor('#654321');
    expect(getRecentColors()).toEqual(['#654321', '#123456']);
  });

  it('дедуп без учёта регистра — повторный выбор поднимает существующий цвет наверх', () => {
    addRecentColor('#123456');
    addRecentColor('#ABCDEF');
    addRecentColor('#123456');
    expect(getRecentColors()).toEqual(['#123456', '#ABCDEF']);
  });

  it('не сохраняет цвет из дефолтной палитры (без учёта регистра)', () => {
    addRecentColor('#ffffff'); // BOARD_COLOR_PALETTE содержит '#FFFFFF'
    expect(getRecentColors()).toEqual([]);
  });

  it('ограничивает список 8 цветами, вытесняя самый старый', () => {
    for (let i = 0; i < 9; i++) {
      addRecentColor(`#${i.toString(16).padStart(6, '0')}`);
    }
    const result = getRecentColors();
    expect(result).toHaveLength(8);
    expect(result[0]).toBe('#000008');
    expect(result).not.toContain('#000000'); // самый первый — вытеснен
  });

  it('не бросает исключение, если localStorage недоступен', () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('quota');
    };
    expect(() => addRecentColor('#123456')).not.toThrow();
    localStorage.setItem = original;
  });
});
