/** Переиспользуемые фрагменты JSON Schema для HTTP-плагинов. */
export const uuidSchema = { type: 'string', format: 'uuid' } as const;

export const nullableUuidSchema = { type: ['string', 'null'], format: 'uuid' } as const;

/** Стандартный параметр маршрута `:id` для доменных сущностей. */
export const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: uuidSchema },
} as const;

/** Query-флаг архивных сущностей: coerceTypes выключен, поэтому принимаем строку. */
export const archivedQuerySchema = {
  type: 'object',
  properties: { archived: { type: 'string', enum: ['true', 'false'] } },
} as const;
