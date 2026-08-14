import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Доменная метка попадает в подписываемое сообщение, поэтому подпись гостя
 * комнаты структурно не может совпасть с подписью гостя доски — даже на общем
 * секрете (он один: `config.auth.guestSecret`) и даже если бы идентификатор
 * доски совпал с идентификатором комнаты.
 *
 * Список закрыт намеренно, это не строка-настройка: метка — часть формата уже
 * выданных токенов, опечатка в ней разлогинит всех гостей домена, а двоеточие
 * внутри неё сделало бы разбор подписываемого сообщения неоднозначным.
 */
export type GuestScope = 'guest' | 'boardGuest';

/** Гостевая сессия живёт максимум столько без переподключения — дальше это уже новый гость */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Формат токена: `<scopeId>.<guestId>.<issuedAt>.<подпись>` */
const TOKEN_PARTS = 4;

export interface GuestSession {
  /** Публичный идентификатор: виден всем участникам */
  guestId: string;
  /** Секрет гостя: сохранить у себя и прислать при переподключении */
  token: string;
}

/**
 * Гостевая сессия, привязанная к сущности (`scopeId` — комната или доска).
 *
 * Идентификатор гостя виден всем участникам (он попадает в список за столом и в
 * presence доски), поэтому подтверждать личность им нельзя — гость возвращается
 * с подписанным токеном, подделать который без секрета нельзя.
 *
 * Токен привязан к конкретной сущности: украденный токен одной комнаты нельзя
 * предъявить в другой.
 */
export class GuestSessions {
  constructor(
    private readonly secret: string,
    private readonly scope: GuestScope,
  ) {}

  /** Новый гость: публичный идентификатор и токен для переподключения именно сюда */
  create(scopeId: string): GuestSession {
    const guestId = randomUUID();
    return { guestId, token: this.issue(scopeId, guestId) };
  }

  /**
   * Гость на входе: вернувшийся — по своему токену, иначе новый. Токен
   * перевыпускается в обоих случаях, поэтому срок жизни отсчитывается от
   * последнего подключения, а не от первого.
   */
  resume(scopeId: string, token: string | undefined): GuestSession {
    const returning = this.verify(scopeId, token);
    return returning
      ? { guestId: returning, token: this.issue(scopeId, returning) }
      : this.create(scopeId);
  }

  issue(scopeId: string, guestId: string): string {
    const issuedAt = Date.now();
    return `${scopeId}.${guestId}.${issuedAt}.${this.sign(scopeId, guestId, issuedAt)}`;
  }

  /**
   * Возвращает идентификатор гостя, только если токен подписан этим секретом в
   * этом скоупе, выдан именно для `scopeId` и не истёк.
   */
  verify(scopeId: string, token: string | undefined): string | null {
    if (!token) {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== TOKEN_PARTS) {
      return null;
    }
    // Длина проверена строкой выше; из неё TS существование индексов не выводит
    const [tokenScopeId, guestId, issuedAtRaw, signature] = parts as [
      string,
      string,
      string,
      string,
    ];
    if (tokenScopeId !== scopeId) {
      return null;
    }
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_TTL_MS) {
      return null;
    }
    return this.matches(this.sign(scopeId, guestId, issuedAt), signature) ? guestId : null;
  }

  private sign(scopeId: string, guestId: string, issuedAt: number): string {
    return createHmac('sha256', this.secret)
      .update(`${this.scope}:${scopeId}:${guestId}:${issuedAt}`)
      .digest('base64url');
  }

  private matches(expected: string, actual: string): boolean {
    const left = Buffer.from(expected);
    const right = Buffer.from(actual);
    // Сравнение постоянного времени: длины должны совпадать до сравнения
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
