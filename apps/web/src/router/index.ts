import {
  createRouter,
  createWebHistory,
  type NavigationGuardWithThis,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
} from 'vue-router';

import { useSessionStore } from '../stores/session';

/** Ключ i18n для заголовка вкладки — только литералы, чтобы t() проверялся по схеме */
type TitleKey =
  | 'nav.home'
  | 'login.title'
  | 'teams.title'
  | 'myRooms.title'
  | 'boards.title'
  | 'nav.profile'
  | 'team.pageTitle'
  | 'teamMember.pageTitle'
  | 'invite.pageTitle'
  | 'room.pageTitle'
  | 'board.pageTitle'
  | 'notFound.title';

declare module 'vue-router' {
  interface RouteMeta {
    /** Страница только для вошедших: гостя уводим на вход */
    requiresAuth?: boolean;
    /** Страница только для гостей: вошедшего уводим на главную */
    guestOnly?: boolean;
    /** Заголовок вкладки: `EstiMate | ${t(titleKey)}` — см. App.vue */
    titleKey: TitleKey;
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../pages/HomePage.vue'),
    meta: { titleKey: 'nav.home' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../pages/LoginPage.vue'),
    meta: { guestOnly: true, titleKey: 'login.title' },
  },
  {
    path: '/teams',
    name: 'teams',
    component: () => import('../pages/TeamsPage.vue'),
    meta: { requiresAuth: true, titleKey: 'teams.title' },
  },
  {
    path: '/my-rooms',
    name: 'my-rooms',
    component: () => import('../pages/MyRoomsPage.vue'),
    meta: { requiresAuth: true, titleKey: 'myRooms.title' },
  },
  {
    path: '/boards',
    name: 'boards',
    component: () => import('../pages/MyBoardsPage.vue'),
    meta: { requiresAuth: true, titleKey: 'boards.title' },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../pages/ProfilePage.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.profile' },
  },
  {
    path: '/teams/:id',
    name: 'team',
    component: () => import('../pages/TeamPage.vue'),
    props: true,
    meta: { requiresAuth: true, titleKey: 'team.pageTitle' },
  },
  {
    path: '/teams/:id/members/:userId',
    name: 'team-member',
    component: () => import('../pages/TeamMemberPage.vue'),
    props: true,
    meta: { requiresAuth: true, titleKey: 'teamMember.pageTitle' },
  },
  {
    // Приглашение открывается и гостю: сначала показываем, куда зовут, а вход
    // просим уже при попытке вступить
    path: '/invite/:code',
    name: 'invite',
    component: () => import('../pages/InvitePage.vue'),
    props: true,
    meta: { titleKey: 'invite.pageTitle' },
  },
  {
    // Вход по прямой ссылке доступен и гостю — он представится именем на месте
    path: '/rooms/:id',
    name: 'room',
    component: () => import('../pages/RoomPage.vue'),
    props: true,
    meta: { titleKey: 'room.pageTitle' },
  },
  {
    // Вход по прямой ссылке доступен только своему владельцу/участнику команды —
    // в отличие от комнаты, доска не рассчитана на анонимного гостя
    path: '/boards/:id',
    name: 'board',
    component: () => import('../pages/BoardPage.vue'),
    props: true,
    meta: { requiresAuth: true, titleKey: 'board.pageTitle' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../pages/NotFoundPage.vue'),
    meta: { titleKey: 'notFound.title' },
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
