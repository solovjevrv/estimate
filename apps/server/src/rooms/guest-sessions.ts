import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Гостевая сессия. Идентификатор гостя виден всем за столом (он попадает в
 * список участников), поэтому подтверждать личность им нельзя — гость
 * возвращается с подписанным токеном, подделать который без секрета нельзя.
 */
export class GuestSessions {
  constructor(private readonly secret: string) {}

  /** Новый гость: публичный идентификатор и токен для переподключения */
  create(): { guestId: string; token: string } {
    const guestId = randomUUID();
    return { guestId, token: this.issue(guestId) };
  }

  issue(guestId: string): string {
    return `${guestId}.${this.sign(guestId)}`;
  }

  /** Возвращает идентификатор гостя или null, если подпись не сходится */
  verify(token: string | undefined): string | null {
    if (!token) {
      return null;
    }
    const separator = token.lastIndexOf('.');
    if (separator <= 0) {
      return null;
    }
    const guestId = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    return this.matches(this.sign(guestId), signature) ? guestId : null;
  }

  private sign(guestId: string): string {
    return createHmac('sha256', this.secret).update(guestId).digest('base64url');
  }

  private matches(expected: string, actual: string): boolean {
    const left = Buffer.from(expected);
    const right = Buffer.from(actual);
    // Сравнение постоянного времени: длины должны совпадать до сравнения
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
