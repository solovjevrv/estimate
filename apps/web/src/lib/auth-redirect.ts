/**
 * Возврат пользователя на исходную страницу после входа через провайдера.
 *
 * Сервер после успешного входа всегда редиректит на «/» и цель перехода не
 * помнит (см. auth.controller — редирект хардкодом). Поэтому цель мы сохраняем
 * здесь, на клиенте, перед уходом к провайдеру, и забираем после возврата.
 */

const KEY = 'estimate:post-login-redirect';

/**
 * Безопасен только внутренний путь: начинается с одиночного «/», не с «//» и не
 * с «/\». Иначе браузер уведёт на чужой сайт (open redirect) — например по
 * `//evil.com`, который выглядит как относительный, но им не является.
 */
export function isSafeInternalPath(path: string): boolean {
  return /^\/(?![/\\])/.test(path);
}

function coercePath(path: unknown): string | null {
  return typeof path === 'string' && isSafeInternalPath(path) ? path : null;
}

/** Запомнить, куда вернуть пользователя. Небезопасные и пустые адреса игнорируются. */
export function rememberRedirect(path: unknown): void {
  const safe = coercePath(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(KEY, safe);
  } catch {
    // Приватный режим или заблокированное хранилище — не критично: просто
    // вернём пользователя на «/» без запоминания цели.
  }
}

/** Разово забрать сохранённую цель (и стереть её), либо null. */
export function takeRedirect(): string | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return coercePath(stored);
  } catch {
    return null;
  }
}
