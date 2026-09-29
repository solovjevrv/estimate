import { describe, expect, it } from 'vitest';

import { darkenHex, readableTextColor } from '../src/features/boards/domain/board-colors';

const TEXT_COLOR_LIGHT = '#FFFFFF';
const TEXT_COLOR_DARK = '#1A1A1A';

describe('darkenHex', () => {
  it('darkens each channel by the given amount (default 0.45)', () => {
    // #FFFFFF -> каждый канал 1.0, затемнение 0.45 -> 0.55
    expect(darkenHex('#FFFFFF')).toBe('#8c8c8c');
  });

  it('clamps results to [0, 255]', () => {
    // #1A1A1A затемнить на 0.45 -> уже очень тёмный, не уходит в отрицательное
    expect(darkenHex('#1A1A1A', 0.9)).toBe('#030303');
  });
});

describe('readableTextColor', () => {
  const validColors = [TEXT_COLOR_LIGHT, TEXT_COLOR_DARK];

  const cases: Array<[string, string]> = [
    ['#FFFFFF', TEXT_COLOR_DARK],
    ['#FCEB96', TEXT_COLOR_DARK],
    ['#A8CAFF', TEXT_COLOR_DARK],
    ['#1A1A1A', TEXT_COLOR_LIGHT],
    ['#1565C0', TEXT_COLOR_LIGHT],
  ];

  it.each(cases)('возвращает %s для фона %s', (bg, expected) => {
    expect(readableTextColor(bg)).toBe(expected);
  });

  it('всегда возвращает один из двух фиксированных цветов, а не оттенок фона', () => {
    const colors = ['#FCEB96', '#A8CAFF', '#1565C0', '#1A1A1A', '#FFFFFF', '#FF6B6B', '#000000'];
    for (const bg of colors) {
      expect(validColors).toContain(readableTextColor(bg));
    }
  });

  it('результат соответствует вычисленному максимуму контраста', () => {
    // Яркий цвет на границе решения: #FFFF00 (жёлтый).
    // Яркость ~0.928 -> контраст с чёрным сильно выше, чем с белым.
    expect(readableTextColor('#FFFF00')).toBe(TEXT_COLOR_DARK);

    // Тёмно-красный #8B0000: яркость ~0.071 -> контраст с белым выше.
    expect(readableTextColor('#8B0000')).toBe(TEXT_COLOR_LIGHT);
  });
});
