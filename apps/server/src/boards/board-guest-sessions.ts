import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** Гостевая сессия доски живёт максимум столько без переподключения — дальше это уже новый гость */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Гостевая сессия доски. Идентификатор гостя виден всем на доске (он попадает в
 * список presence), поэтому подтверждать личность им нельзя — гость
 * возвращается с подписанным токеном, подделать который без секрета нельзя.
 *
 * Токен привязан к конкретной доске (иначе украденный токен одной доски можно
 * было бы предъявить в любой другой) и содержит доменную метку `boardGuest`
 * в подписываемом сообщении — так подпись этой схемы структурно не может
 * совпасть с подписью гостевых сессий комнат (`guest`) на том же секрете,
 * даже если бы boardId теоретически совпал с roomId.
 */
export class BoardGuestSessions {
  constructor(private readonly secret: string) {}

  /** Новый гость доски: публичный идентификатор и токен для переподключения именно к этой доске */
  create(boardId: string): { guestId: string; token: string } {
    const guestId = randomUUID();
    return { guestId, token: this.issue(boardId, guestId) };
  }

  issue(boardId: string, guestId: string): string {
    const issuedAt = Date.now();
    return `${boardId}.${guestId}.${issuedAt}.${this.sign(boardId, guestId, issuedAt)}`;
  }

  /**
   * Возвращает идентификатор гостя, только если токен подписан этим секретом,
   * выдан именно для `boardId` и не истёк.
   */
  verify(boardId: string, token: string | undefined): string | null {
    if (!token) {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 4) {
      return null;
    }
    const [tokenBoardId, guestId, issuedAtRaw, signature] = parts as [
      string,
      string,
      string,
      string,
    ];
    if (tokenBoardId !== boardId) {
      return null;
    }
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_TTL_MS) {
      return null;
    }
    return this.matches(this.sign(boardId, guestId, issuedAt), signature) ? guestId : null;
  }

  private sign(boardId: string, guestId: string, issuedAt: number): string {
    return createHmac('sha256', this.secret)
      .update(`boardGuest:${boardId}:${guestId}:${issuedAt}`)
      .digest('base64url');
  }

  private matches(expected: string, actual: string): boolean {
    const left = Buffer.from(expected);
    const right = Buffer.from(actual);
    // Сравнение постоянного времени: длины должны совпадать до сравнения
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
