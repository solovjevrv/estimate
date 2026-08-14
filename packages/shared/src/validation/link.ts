/** Ссылка в пользовательском поле допускает только web-схемы. */
export const HTTP_URL_PATTERN = /^https?:\/\//i;

export function isHttpUrl(value: string): boolean {
  return HTTP_URL_PATTERN.test(value);
}
