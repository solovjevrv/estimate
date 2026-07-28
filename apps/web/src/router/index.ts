import {
  createRouter,
  createWebHistory,
  type NavigationGuardWithThis,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
} from 'vue-router';

import { useSessionStore } from '../stores/session';

declare module 'vue-router' {
  interface RouteMeta {
    /** Страница только для вошедших: гостя уводим на вход */
    requiresAuth?: boolean;
    /** Страница только для гостей: вошедшего уводим на главную */
    guestOnly?: boolean;
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../pages/HomePage.vue'),
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../pages/LoginPage.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/teams',
    name: 'teams',
    component: () => import('../pages/TeamsPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/my-rooms',
    name: 'my-rooms',
    component: () => import('../pages/MyRoomsPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../pages/ProfilePage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/teams/:id',
    name: 'team',
    component: () => import('../pages/TeamPage.vue'),
    props: true,
    meta: { requiresAuth: true },
  },
  {
    // Приглашение открывается и гостю: сначала показываем, куда зовут, а вход
    // просим уже при попытке вступить
    path: '/invite/:code',
    name: 'invite',
    component: () => import('../pages/InvitePage.vue'),
    props: true,
  },
  {
    // Вход по прямой ссылке доступен и гостю — он представится именем на месте
    path: '/rooms/:id',
    name: 'room',
    component: () => import('../pages/RoomPage.vue'),
    props: true,
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../pages/NotFoundPage.vue'),
  },
];

/**
 * Гард ждёт единственный запрос профиля: до ответа неизвестно, вошёл
 * пользователь или нет, а гнать его на страницу входа раньше времени нельзя —
 * при перезагрузке приватной страницы это выбрасывало бы его каждый раз.
 */
export const authGuard: NavigationGuardWithThis<undefined> = async (to) => {
  const session = useSessionStore();
  await session.ensureLoaded();

  if (to.meta.requiresAuth && !session.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  if (to.meta.guestOnly && session.isAuthenticated) {
    return { name: 'home' };
  }

  return true;
};

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const router = createRouter({ history, routes });
  router.beforeEach(authGuard);
  return router;
}
