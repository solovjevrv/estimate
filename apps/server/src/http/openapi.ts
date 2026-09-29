/**
 * Общие константы документации. Отдельный модуль без зависимостей:
 * его импортируют все плагины с роутами, а тяжёлый Scalar подтягивается
 * только когда документация включена.
 */

/** Путь, по которому открывается интерактивная документация */
export const DOCS_PATH = '/api/docs';
/** Путь к самой спецификации OpenAPI */
export const OPENAPI_PATH = '/api/openapi.json';

export const DOCS_TAGS = {
  service: 'Служебные',
  auth: 'Аутентификация',
  teams: 'Команды',
  rooms: 'Комнаты',
  boards: 'Доски',
} as const;

/** Общий формат ошибки: на него ссылаются схемы ответов */
export const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Машиночитаемый код ошибки' },
    message: { type: 'string', description: 'Сообщение для пользователя' },
  },
} as const;
