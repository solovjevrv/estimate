/** Коды ошибок PostgreSQL, которые разбираем по смыслу */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

interface DriverError {
  code?: string;
  constraint?: string;
}

/** Drizzle оборачивает ошибку драйвера: код и имя констрейнта лежат в cause */
function driverError(err: unknown): DriverError {
  const cause = (err as { cause?: DriverError }).cause;
  return cause?.code ? cause : ((err as DriverError) ?? {});
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const { code, constraint: name } = driverError(err);
  return code === UNIQUE_VIOLATION && (!constraint || name === constraint);
}

export function isForeignKeyViolation(err: unknown, constraint?: string): boolean {
  const { code, constraint: name } = driverError(err);
  return code === FOREIGN_KEY_VIOLATION && (!constraint || name === constraint);
}
