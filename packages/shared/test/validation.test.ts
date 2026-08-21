import { describe, expect, it } from 'vitest';

import {
  HTTP_URL_PATTERN,
  isHttpUrl,
  isTextLengthInRange,
  isValidUuid,
  TEXT_INPUT_TRIM_ALLOWANCE,
  trimOptionalText,
  trimText,
  UUID_PATTERN,
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

  it('принимает только валидный UUID (16.3 — единая реализация для board-ops/boards.service/rooms.service)', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
    expect(isValidUuid('')).toBe(false);
    expect(UUID_PATTERN.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
});
