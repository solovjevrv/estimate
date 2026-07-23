/**
 * Ошибки приложения. Сервисы бросают их, не зная про HTTP, — перевод в ответ
 * делает единственный обработчик (src/http/error-handler.ts).
 */
export abstract class AppError extends Error {
  /** HTTP-код ответа */
  abstract readonly statusCode: number;
  /** Машиночитаемый код для клиента */
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'bad_request';
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly code = 'unauthorized';

  constructor(message = 'Требуется вход', options?: ErrorOptions) {
    super(message, options);
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = 'forbidden';
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'not_found';
}

/** Запрос понятен, но противоречит текущему состоянию данных */
export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'conflict';
}
