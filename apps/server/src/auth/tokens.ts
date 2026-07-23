import type { JWT } from '@fastify/jwt';
import type { FastifyReply } from 'fastify';

export type TokenType = 'access' | 'refresh';

export interface SessionPayload {
  /** id пользователя */
  sub: string;
  /** Тип токена: короткоживущий access или долгоживущий refresh */
  typ: TokenType;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionPayload;
    user: SessionPayload;
  }
}

export const ACCESS_COOKIE = 'pp_access';
export const REFRESH_COOKIE = 'pp_refresh';
/** Refresh-кука уходит только на эндпоинты аутентификации */
export const REFRESH_COOKIE_PATH = '/api/auth';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SessionTokens {
  access: string;
  refresh: string;
}

export function signSession(jwt: JWT, userId: string): SessionTokens {
  return {
    access: jwt.sign({ sub: userId, typ: 'access' }, { expiresIn: ACCESS_TTL_SECONDS }),
    refresh: jwt.sign({ sub: userId, typ: 'refresh' }, { expiresIn: REFRESH_TTL_SECONDS }),
  };
}

/**
 * Проверяет подпись, срок жизни и тип токена.
 * Возвращает id пользователя или null — вызывающий сам решает, 401 это или гость.
 */
export function verifySessionToken(jwt: JWT, token: string, expected: TokenType): string | null {
  try {
    const payload = jwt.verify<SessionPayload>(token);
    if (payload.typ !== expected || typeof payload.sub !== 'string' || !payload.sub) {
      return null;
    }
    return payload.sub;
  } catch {
    return null;
  }
}

export function setSessionCookies(
  reply: FastifyReply,
  tokens: SessionTokens,
  secure: boolean,
): void {
  // sameSite: 'lax' — куки доезжают при возврате с OAuth-провайдера (top-level GET)
  // и при этом не отправляются с кросс-сайтовых POST-запросов (защита от CSRF)
  reply.setCookie(ACCESS_COOKIE, tokens.access, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: ACCESS_TTL_SECONDS,
  });
  reply.setCookie(REFRESH_COOKIE, tokens.refresh, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TTL_SECONDS,
  });
}

export function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(ACCESS_COOKIE, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
  reply.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: REFRESH_COOKIE_PATH,
  });
}
