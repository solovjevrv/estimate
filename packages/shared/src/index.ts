/**
 * Общие типы и контракты, используемые фронтендом и бэкендом.
 * Контракты WebSocket-событий будут детализированы в задаче 2.4.
 */

export const WS_EVENTS = {
  JOIN_ROOM: 'join_room',
  SUBMIT_VOTE: 'submit_vote',
  REVEAL_CARDS: 'reveal_cards',
  START_NEW_ROUND: 'start_new_round',
  UPDATE_LINKS: 'update_links',
} as const;

export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/** OAuth-провайдеры, через которых можно войти */
export type AuthProvider = 'google' | 'yandex';

export const AUTH_PROVIDERS: readonly AuthProvider[] = ['google', 'yandex'];

/** Публичный профиль авторизованного пользователя (отдаётся фронту) */
export interface AuthUser {
  id: string;
  provider: AuthProvider;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** Роли участника внутри команды */
export type TeamRole = 'owner' | 'admin' | 'member' | 'guest';

/** Роли от старшей к младшей: право старшей роли включает права всех младших */
export const TEAM_ROLES: readonly TeamRole[] = ['owner', 'admin', 'member', 'guest'];

/** Чем меньше вес, тем больше прав */
const TEAM_ROLE_WEIGHT: Record<TeamRole, number> = { owner: 0, admin: 1, member: 2, guest: 3 };

/** Хватает ли роли `role` там, где требуется не ниже `required` */
export function hasTeamRole(role: TeamRole, required: TeamRole): boolean {
  return TEAM_ROLE_WEIGHT[role] <= TEAM_ROLE_WEIGHT[required];
}

export interface Team {
  id: string;
  name: string;
  createdAt: string;
}

/** Команда в списке пользователя — вместе с его ролью в ней */
export interface TeamWithRole extends Team {
  role: TeamRole;
}

/** Участник команды: профиль пользователя + роль */
export interface TeamMember {
  userId: string;
  name: string;
  /** Гостям команды адреса участников не показываются */
  email?: string;
  avatarUrl: string | null;
  role: TeamRole;
  joinedAt: string;
}

/** Ограничения на название команды */
export const TEAM_NAME_MIN_LENGTH = 1;
export const TEAM_NAME_MAX_LENGTH = 80;

/** Роли участника внутри комнаты */
export type RoomRole = 'scrum_master' | 'voter';

/** Типы колод для оценки */
export type DeckType = 'fibonacci' | 'scale_0_5';

export const FIBONACCI_DECK: readonly number[] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

export const SCALE_0_5_DECK: readonly number[] = [0, 1, 2, 3, 4, 5];
