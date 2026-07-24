import type { Router } from 'vue-router';

import { takeRedirect } from '../lib/auth-redirect';

/** Минимум, который нужен от стора сессии: вошёл пользователь или нет. */
interface SessionLike {
  readonly isAuthenticated: boolean;
}

/**
 * Разово, на первом старте приложения, забирает отложенную цель входа и уводит
 * туда вошедшего пользователя. Сервер после входа всегда возвращает на «/», так
 * что без этого шага гость, кликнувший приватную ссылку, после входа оставался
 * бы на главной вместо страницы, куда шёл.
 *
 * Цель забирается всегда (и стирается), даже если вход не удался — иначе
 * устаревший адрес всплыл бы при следующем заходе.
 */
export async function applyPostLoginRedirect(router: Router, session: SessionLike): Promise<void> {
  await router.isReady();
  const target = takeRedirect();
  if (target && session.isAuthenticated) {
    await router.replace(target);
  }
}
