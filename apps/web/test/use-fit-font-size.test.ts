import { describe, expect, it } from 'vitest';

import {
  FIT_FONT_MIN,
  getScaledFontSize,
  longestWordWidth,
  unscaleFontSizeStep,
} from '../src/lib/board/use-fit-font-size';

describe('getScaledFontSize', () => {
  it('сохраняет базовый размер при дефолтной геометрии стикера', () => {
    expect(getScaledFontSize(20, 180, 180, 180, 180)).toBe(20);
  });

  it('увеличивает текст вместе с квадратным стикером', () => {
    expect(getScaledFontSize(20, 360, 360, 180, 180)).toBe(40);
  });

  it('увеличивает текст фигуры по меньшей оси непропорционального бокса', () => {
    expect(getScaledFontSize(20, 480, 240, 160, 120)).toBe(40);
  });

  it('масштабирует вручную выбранную базу и не ограничивает результат 48px', () => {
    expect(getScaledFontSize(36, 360, 360, 180, 180)).toBe(72);
  });

  it('не опускает производный размер ниже минимально читаемого', () => {
    expect(getScaledFontSize(20, 20, 20, 180, 180)).toBe(FIT_FONT_MIN);
  });
});

describe('longestWordWidth', () => {
  // measureWidth внедряется — реальный Canvas 2D в jsdom недоступен без
  // отдельного полифилла, поэтому логика поиска самого длинного слова
  // тестируется отдельно от способа измерения.
  const widthByLength = (word: string): number => word.length * 10;

  it('возвращает 0 для пустой строки', () => {
    expect(longestWordWidth('', widthByLength)).toBe(0);
  });

  it('находит самое длинное слово среди нескольких', () => {
    expect(longestWordWidth('корот среднийслово дл', widthByLength)).toBe(120);
  });

  it('игнорирует лишние пробелы/переносы строк между словами', () => {
    expect(longestWordWidth('  а   бб\nввв  ', widthByLength)).toBe(30);
  });

  it('одно длинное слово без пробелов — вся строка целиком', () => {
    expect(longestWordWidth('Иллюстрация', widthByLength)).toBe(110);
  });
});

describe('unscaleFontSizeStep (18.5)', () => {
  it('при небольшом масштабе переводит целевой displayed-размер в базовый напрямую', () => {
    // scale=2, currentBase=20 (displayed=40), клик "+2" → target=42
    expect(unscaleFontSizeStep(20, 42, 2)).toBe(21);
  });

  it('гарантирует минимум ±1 к базе, если округление откатывается к текущему значению', () => {
    // Регресс: объект увеличен в 5 раз (scale=5), currentBase=20 (displayed=100).
    // Клик "+2" → target=102 → 102/5=20.4 → round=20 === currentBase, без
    // гарантии минимума клик молча ничего не менял бы (залипшие кнопки).
    expect(unscaleFontSizeStep(20, 102, 5)).toBe(21);
  });

  it('минимальный шаг идёт в сторону клика (уменьшение)', () => {
    expect(unscaleFontSizeStep(20, 98, 5)).toBe(19);
  });

  it('не откатывается, если пересчёт и так даёт другое значение', () => {
    expect(unscaleFontSizeStep(20, 110, 5)).toBe(22);
  });
});
