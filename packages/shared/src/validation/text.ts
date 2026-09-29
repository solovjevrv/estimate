/**
 * Нормализация и проверка коротких пользовательских текстов. Это чистые
 * правила контракта: приложения сами решают, как показать ошибку.
 */
export interface TextLengthRange {
  min: number;
  max: number;
}

/** Запас HTTP-схемы на внешние пробелы до бизнес-проверки после trim. */
export const TEXT_INPUT_TRIM_ALLOWANCE = 100;

/** Убирает внешние пробелы перед сохранением или проверкой текста. */
export function trimText(raw: string): string {
  return raw.trim();
}

/** Проверяет длину уже нормализованной строки; границы включительны. */
export function isTextLengthInRange(value: string, range: TextLengthRange): boolean {
  return value.length >= range.min && value.length <= range.max;
}

/** Пустой необязательный текст нормализуется в null, а не в пустую строку. */
export function trimOptionalText(raw: string | null | undefined): string | null {
  const value = typeof raw === 'string' ? trimText(raw) : '';
  return value.length > 0 ? value : null;
}
