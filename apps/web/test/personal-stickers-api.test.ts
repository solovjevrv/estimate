/**
 * Тесты parseTelegramSetName (21.6): пользователь может вставить либо голое
 * имя стикер-сета, либо полную ссылку t.me/addstickers/:name — сервер
 * принимает только голое имя (pattern ^[A-Za-z0-9_]+$), парсинг должен
 * произойти на фронте до отправки (см. TelegramStickerImportModal.vue).
 */
import { describe, expect, it } from 'vitest';

import { parseTelegramSetName } from '../src/features/boards/api/personal-stickers-api';

describe('parseTelegramSetName', () => {
  it('принимает голое имя как есть', () => {
    expect(parseTelegramSetName('stickers')).toBe('stickers');
  });

  it('извлекает имя из полной ссылки https://t.me/addstickers/:name', () => {
    expect(parseTelegramSetName('https://t.me/addstickers/CoolPack_by_bot')).toBe(
      'CoolPack_by_bot',
    );
  });

  it('извлекает имя из ссылки без протокола', () => {
    expect(parseTelegramSetName('t.me/addstickers/stickers')).toBe('stickers');
  });

  it('терпит trailing slash и пробелы по краям', () => {
    expect(parseTelegramSetName('  t.me/addstickers/stickers/  ')).toBe('stickers');
  });

  it('отклоняет нераспознаваемую строку', () => {
    expect(parseTelegramSetName('что-то совсем не то ?!')).toBeNull();
  });

  it('отклоняет пустую строку', () => {
    expect(parseTelegramSetName('')).toBeNull();
  });

  it('отклоняет ссылку с query-параметрами', () => {
    expect(parseTelegramSetName('https://t.me/addstickers/stickers?ref=abc')).toBeNull();
  });
});
