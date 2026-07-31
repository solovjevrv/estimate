import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** Гостевая сессия живёт максимум столько без переподключения — дальше это уже новый гость */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Гостевая сессия. Идентификатор гостя виден всем за столом (он попадает в
 * список участников), поэтому подтверждать личность им нельзя — гость
 * возвращается с подписанным токеном, подделать который без секрета нельзя.
 *
 * Токен привязан к конкретной комнате (иначе украденный токен одной комнаты
 * можно было бы предъявить в любой другой) и содержит доменную метку в
 * подписываемом сообщении — так подпись этой схемы структурно не может
 * совпасть с подписью другой HMAC-схемы на этом же секрете.
 */
export class GuestSessions {
  constructor(private readonly secret: string) {}

  /** Новый гость: публичный идентификатор и токен для переподключения именно в эту комнату */
  create(roomId: string): { guestId: string; token: string } {
    const guestId = randomUUID();
    return { guestId, token: this.issue(roomId, guestId) };
  }

  issue(roomId: string, guestId: string): string {
    const issuedAt = Date.now();
    return `${roomId}.${guestId}.${issuedAt}.${this.sign(roomId, guestId, issuedAt)}`;
  }

  /**
   * Возвращает идентификатор гостя, только если токен подписан этим секретом,
   * выдан именно для `roomId` и не истёк.
   */
  verify(roomId: string, token: string | undefined): string | null {
    if (!token) {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 4) {
      return null;
    }
    const [tokenRoomId, guestId, issuedAtRaw, signature] = parts as [
      string,
      string,
      string,
      string,
    ];
    if (tokenRoomId !== roomId) {
      return null;
    }
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_TTL_MS) {
      return null;
    }
    return this.matches(this.sign(roomId, guestId, issuedAt), signature) ? guestId : null;
  }

  private sign(roomId: string, guestId: string, issuedAt: number): string {
    return createHmac('sha256', this.secret)
      .update(`guest:${roomId}:${guestId}:${issuedAt}`)
      .digest('base64url');
  }

  private matches(expected: string, actual: string): boolean {
    const left = Buffer.from(expected);
    const right = Buffer.from(actual);
    // Сравнение постоянного времени: длины должны совпадать до сравнения
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
