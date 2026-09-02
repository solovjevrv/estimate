/**
 * Экспорт доски в PNG (15.5) — единственная чистая часть: имя файла.
 * Markdown-выгрузка была в первой версии задачи и снята по решению
 * пользователя (31.08.2026) как лишняя. Сам PNG-рендер (DOM/Vue Flow) —
 * в `use-board-export.ts`.
 */
// eslint-disable-next-line no-control-regex -- контрольные символы недопустимы в именах файлов на любой ОС
const FILENAME_UNSAFE_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;
const FILENAME_MAX_TITLE_LENGTH = 100;

/** `{название}-{YYYY-MM-DD}.png`, название очищено от символов, недопустимых в именах файлов */
export function buildExportFilename(boardTitle: string): string {
  const safeTitle =
    boardTitle
      .trim()
      .replace(FILENAME_UNSAFE_CHARS, '_')
      .replace(/\s+/g, ' ')
      .slice(0, FILENAME_MAX_TITLE_LENGTH) || 'board';
  const date = new Date().toISOString().slice(0, 10);
  return `${safeTitle}-${date}.png`;
}
