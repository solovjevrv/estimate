/**
 * Тонкая обёртка над fetch: единый разбор ошибок сервера и одна попытка
 * продлить сессию, когда access-кука протухла.
 */

/** Ошибка ответа сервера: код совпадает с тем, что отдаёт бэкенд (`unauthorized`, `conflict`, ...) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Путь продления сессии — его самого повторять после 401 нельзя, иначе получится цикл */
const REFRESH_PATH = '/api/auth/refresh';

/**
 * Продление идёт одной общей попыткой: параллельные запросы, поймавшие 401,
 * ждут её результат, а не дёргают refresh каждый за себя.
 */
let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(REFRESH_PATH, { method: 'POST', credentials: 'include' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  const fallback = `Запрос завершился ошибкой ${res.status}`;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const { error, message } = body as { error?: unknown; message?: unknown };
      return new ApiError(
        res.status,
        typeof error === 'string' ? error : 'unknown',
        typeof message === 'string' ? message : fallback,
      );
    }
  } catch {
    // Тело не JSON (например, страница nginx) — остаётся только код ответа
  }
  return new ApiError(res.status, 'unknown', fallback);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    // Сессия живёт в httpOnly-куках, поэтому их нужно слать всегда
    credentials: 'include',
    headers:
      init.body === undefined
        ? init.headers
        : { 'content-type': 'application/json', ...init.headers },
  });
}

/**
 * Запрос к API. При 401 один раз пробует продлить сессию и повторить —
 * так истёкший access-токен не выкидывает пользователя со страницы.
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init);

  if (res.status === 401 && path !== REFRESH_PATH) {
    if (await refreshSession()) {
      res = await send(path, init);
    }
  }

  if (!res.ok) {
    throw await toError(res);
  }

  // 204 и пустое тело — штатный ответ, например у выхода
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
