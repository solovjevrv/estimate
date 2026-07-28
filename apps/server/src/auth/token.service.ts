import type { JWT } from '@fastify/jwt';
import type { FastifyReply } from 'fastify';

export type TokenType = 'access' | 'refresh';

export interface SessionPayload {
  /** id пользователя */
  sub: string;
  /** Тип токена: короткоживущий access или долгоживущий refresh */
  typ: TokenType;
  /**
   * Id строки в `sessions` — только у refresh-токена. По нему обмен токена
   * проверяет, что сессию не отозвали (выход, ротация при прошлом обмене) (7.6).
   * Access-токен остаётся полностью stateless: смысла ходить в БД на каждый
   * запрос ради 15-минутного токена нет.
   */
  jti?: string;
  /** Момент истечения (секунды Unix) — добавляется библиотекой при `sign()` с `expiresIn` */
  exp?: number;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionPayload;
    user: SessionPayload;
  }
}

export interface SessionTokens {
  access: string;
  refresh: string;
}

export const ACCESS_COOKIE = 'pp_access';
export const REFRESH_COOKIE = 'pp_refresh';
/** Refresh-кука уходит только на эндпоинты аутентификации */
export const REFRESH_COOKIE_PATH = '/api/auth';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Выпуск, проверка и перенос сессии в куках */
export class TokenService {
  constructor(
    private readonly jwt: JWT,
    private readonly cookieSecure: boolean,
  ) {}

  /** `refreshJti` — id только что созданной строки в `sessions`, на которую опирается отзыв (7.6) */
  issue(userId: string, refreshJti: string): SessionTokens {
    return {
      access: this.jwt.sign({ sub: userId, typ: 'access' }, { expiresIn: ACCESS_TTL_SECONDS }),
      refresh: this.jwt.sign(
        { sub: userId, typ: 'refresh', jti: refreshJti },
        { expiresIn: REFRESH_TTL_SECONDS },
      ),
    };
  }

  /**
   * Проверяет подпись, срок жизни и тип токена.
   * Возвращает id пользователя или null — вызывающий сам решает, 401 это или гость.
   */
  verify(token: string, expected: TokenType): string | null {
    try {
      const payload = this.jwt.verify<SessionPayload>(token);
      if (payload.typ !== expected || typeof payload.sub !== 'string' || !payload.sub) {
        return null;
      }
      return payload.sub;
    } catch {
      return null;
    }
  }

  /**
   * То же самое для refresh-токена, но дополнительно достаёт `jti` — без него
   * нечем проверить отзыв сессии в БД.
   */
  verifyRefresh(token: string): { userId: string; jti: string } | null {
    try {
      const payload = this.jwt.verify<SessionPayload>(token);
      if (
        payload.typ !== 'refresh' ||
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        typeof payload.jti !== 'string' ||
        !payload.jti
      ) {
        return null;
      }
      return { userId: payload.sub, jti: payload.jti };
    } catch {
      return null;
    }
  }

  /**
   * Разбор сырого заголовка Cookie — нужен Socket.io, который не проходит через роутинг.
   * Возвращает и момент истечения токена: хендшейк происходит один раз на всё
   * время жизни соединения, поэтому дальше сокет обязан сам знать, когда его
   * куском выданная личность устареет (7.7).
   */
  readAccessSessionFromCookieHeader(
    cookieHeader: string | undefined,
  ): { userId: string; expiresAt: number } | null {
    if (!cookieHeader) {
      return null;
    }
    const token = this.readCookie(cookieHeader, ACCESS_COOKIE);
    if (!token) {
      return null;
    }
    try {
      const payload = this.jwt.verify<SessionPayload>(token);
      if (payload.typ !== 'access' || typeof payload.sub !== 'string' || !payload.sub) {
        return null;
      }
      return { userId: payload.sub, expiresAt: (payload.exp ?? 0) * 1000 };
    } catch {
      return null;
    }
  }

  /** Свой разбор вместо @fastify/cookie: у сокета нет экземпляра Fastify под рукой */
  private readCookie(header: string, name: string): string | undefined {
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1 || part.slice(0, separator).trim() !== name) {
        continue;
      }
      const raw = part.slice(separator + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
    return undefined;
  }

  setCookies(reply: FastifyReply, tokens: SessionTokens): void {
    // sameSite: 'lax' — куки доезжают при возврате с OAuth-провайдера (top-level GET)
    // и при этом не отправляются с кросс-сайтовых POST-запросов (защита от CSRF)
    reply.setCookie(ACCESS_COOKIE, tokens.access, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cookieSecure,
      path: '/',
      maxAge: ACCESS_TTL_SECONDS,
    });
    reply.setCookie(REFRESH_COOKIE, tokens.refresh, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cookieSecure,
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TTL_SECONDS,
    });
  }

  clearCookies(reply: FastifyReply): void {
    const base = { httpOnly: true, sameSite: 'lax', secure: this.cookieSecure } as const;
    reply.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
    reply.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
  }
}
