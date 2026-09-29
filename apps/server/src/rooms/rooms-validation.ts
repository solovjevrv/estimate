import {
  DECK_TYPES,
  isHttpUrl,
  isTextLengthInRange,
  isValidUuid,
  ROOM_LINK_MAX_LENGTH,
  trimOptionalText,
  trimText,
  TSHIRT_DECK,
  type DeckType,
  type Round,
} from '@estimate/shared';

import { isForeignKeyViolation, isUniqueViolation } from '../db/errors';
import { ConflictError, ForbiddenError, ValidationError } from '../errors';

/** Верхняя граница оценки: защищает от переполнения integer в базе */
const MAX_VOTE_VALUE = 1000;

/** Внешние ключи голоса: по ним отличаем удалённый раунд от удалённого аккаунта */
const VOTE_ROUND_FK = 'votes_round_id_rounds_id_fk';
const VOTE_USER_FK = 'votes_user_id_users_id_fk';

/** Идентификаторы приходят по сокету без схем — проверяем формат до похода в базу */
export function requireRoomUuid(value: string, what: string): string {
  if (typeof value !== 'string' || !isValidUuid(value)) {
    throw new ValidationError(`Некорректный идентификатор ${what}`);
  }
  return value;
}

export function requireDeckType(value: unknown): DeckType {
  if (!DECK_TYPES.includes(value as DeckType)) {
    throw new ValidationError('Неизвестный тип колоды');
  }
  return value as DeckType;
}

export function normalizeRoomText(raw: string, maxLength: number, field: string): string {
  const value = trimText(raw);
  if (!isTextLengthInRange(value, { min: 1, max: maxLength })) {
    throw new ValidationError(`${field}: от 1 до ${maxLength} символов`);
  }
  return value;
}

/** Пустая строка означает «ссылку убрали» */
export function normalizeRoomLink(raw: string | null | undefined): string | null {
  const value = trimOptionalText(raw);
  if (!value) {
    return null;
  }
  if (value.length > ROOM_LINK_MAX_LENGTH) {
    throw new ValidationError('Ссылка слишком длинная');
  }
  if (!isHttpUrl(value)) {
    throw new ValidationError('Ссылка должна начинаться с http:// или https://');
  }
  return value;
}

export function assertVoteValue(round: Round, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_VOTE_VALUE) {
    throw new ValidationError(`Оценка должна быть целым числом от 0 до ${MAX_VOTE_VALUE}`);
  }
  // У колоды Фибоначчи можно добавить своё число, у шкалы и футболочных размеров — только из колоды
  if (round.deckType === 'scale_0_5' && value > 5) {
    throw new ValidationError('Для шкалы допустимы значения от 0 до 5');
  }
  if (round.deckType === 'tshirt' && !TSHIRT_DECK.includes(value)) {
    throw new ValidationError('Для футболочных размеров допустимы только числа из колоды');
  }
}

/** Стол мог исчезнуть под руками: раунд удалили вместе с комнатой, аккаунт — вместе с сессией */
export function rethrowVoteFailure(err: unknown): never {
  if (isForeignKeyViolation(err, VOTE_ROUND_FK)) {
    throw new ConflictError('Раунд уже завершён, обновите страницу');
  }
  if (isForeignKeyViolation(err, VOTE_USER_FK)) {
    throw new ForbiddenError('Аккаунт не найден, войдите заново');
  }
  // Страховка: голос того же участника в тот же раунд уже есть
  if (isUniqueViolation(err)) {
    throw new ConflictError('Не удалось учесть оценку, попробуйте ещё раз');
  }
  throw err;
}
