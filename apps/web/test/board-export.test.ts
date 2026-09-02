import { describe, expect, it } from 'vitest';

import { buildExportFilename } from '../src/features/boards/domain/board-export';

describe('buildExportFilename', () => {
  it('добавляет дату и .png к очищенному названию доски', () => {
    const filename = buildExportFilename('Ретро спринта 24');
    expect(filename).toMatch(/^Ретро спринта 24-\d{4}-\d{2}-\d{2}\.png$/);
  });

  it('заменяет символы, недопустимые в именах файлов, на подчёркивание', () => {
    const filename = buildExportFilename('Доска: "Q3" <план>/бэклог');
    expect(filename).not.toMatch(/[\\/:*?"<>|]/);
    expect(filename.endsWith('.png')).toBe(true);
  });

  it('подставляет "board", если название пустое после очистки', () => {
    const filename = buildExportFilename('   ');
    expect(filename.startsWith('board-')).toBe(true);
  });
});
