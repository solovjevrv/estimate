import { describe, expect, it } from 'vitest';

import {
  HTTP_URL_PATTERN,
  isHttpUrl,
  isTextLengthInRange,
  TEXT_INPUT_TRIM_ALLOWANCE,
  trimOptionalText,
  trimText,
} from '../src/index';

describe('общая текстовая валидация', () => {
  it('нормализует внешние пробелы', () => {
    expect(trimText('  значение  ')).toBe('значение');
  });

  it('считает границы длины включительными и не принимает строку из пробелов', () => {
    expect(isTextLengthInRange(trimText('  abc  '), { min: 1, max: 3 })).toBe(true);
    expect(isTextLengthInRange(trimText('abcd'), { min: 1, max: 3 })).toBe(false);
    expect(isTextLengthInRange(trimText('   '), { min: 1, max: 3 })).toBe(false);
  });

  it('нормализует пустой optional-текст в null', () => {
    expect(trimOptionalText(undefined)).toBeNull();
    expect(trimOptionalText(null)).toBeNull();
    expect(trimOptionalText('  ')).toBeNull();
    expect(trimOptionalText('  должность ')).toBe('должность');
  });

  it('принимает только http(s)-ссылки', () => {
    expect(isHttpUrl('https://example.test')).toBe(true);
    expect(isHttpUrl('HTTP://example.test')).toBe(true);
    expect(isHttpUrl('ftp://example.test')).toBe(false);
    expect(isHttpUrl('/relative-url')).toBe(false);
    expect(HTTP_URL_PATTERN.test('https://example.test')).toBe(true);
  });

  it('явно фиксирует запас HTTP-схемы на trim', () => {
    expect(TEXT_INPUT_TRIM_ALLOWANCE).toBe(100);
  });
});
