/** Общие типы и контракты, используемые фронтендом и бэкендом. */

import type { AuthProvider } from './auth';

/** Роли участника внутри команды. Администраторов может быть несколько — все равны в правах. */
export type TeamRole = 'admin' | 'member' | 'guest';

/** Роли от старшей к младшей: право старшей роли включает права всех младших */
export const TEAM_ROLES: readonly TeamRole[] = ['admin', 'member', 'guest'];

/** Чем меньше вес, тем больше прав */
const TEAM_ROLE_WEIGHT: Record<TeamRole, number> = { admin: 0, member: 1, guest: 2 };

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
  /** Сколько всего участников в команде (не только видимых текущему пользователю) */
  memberCount: number;
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

/** Данные участника для его собственной страницы (10.14) — то же, что видно на «Мой профиль» */
export interface TeamMemberProfile extends TeamMember {
  provider: AuthProvider;
  jobTitle: string | null;
}

/** Загрузка аватарки (10.15) — верхняя граница исходника до пережатия и допустимые типы файла */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
export const AVATAR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Ограничения на название команды */
export const TEAM_NAME_MIN_LENGTH = 1;
export const TEAM_NAME_MAX_LENGTH = 80;
