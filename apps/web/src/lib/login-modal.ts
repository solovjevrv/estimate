import { reactive } from 'vue';

/**
 * Окно входа (27_Modal «Login dialog») открывается поверх текущей страницы —
 * кнопкой «Войти» в шапке, на главной или в приглашении, без перехода. Маршрут
 * /login при этом остаётся: на него ведут гард приватных страниц и сервер после
 * неудачного OAuth (?error=oauth), там окно открыто поверх главной (см. App.vue).
 */
export const loginModal = reactive<{ open: boolean; redirect: string | null }>({
  open: false,
  redirect: null,
});

/** Открыть окно входа; redirect — куда вернуть пользователя после входа. */
export function openLogin(redirect: string | null = null): void {
  loginModal.redirect = redirect;
  loginModal.open = true;
}
