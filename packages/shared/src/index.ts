/** Общие типы и контракты, используемые фронтендом и бэкендом. */

/** События, которые клиент отправляет серверу */
export const WS_EVENTS = {
  JOIN_ROOM: 'join_room',
  SUBMIT_VOTE: 'submit_vote',
  REVEAL_CARDS: 'reveal_cards',
  START_NEW_ROUND: 'start_new_round',
  UPDATE_LINKS: 'update_links',
} as const;

export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/**
 * События сервера. Состояние комнаты рассылается целиком: комнаты небольшие,
 * а один снимок исключает расхождения между участниками.
 */
export const WS_SERVER_EVENTS = {
  ROOM_STATE: 'room_state',
} as const;

export type WsServerEvent = (typeof WS_SERVER_EVENTS)[keyof typeof WS_SERVER_EVENTS];

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

/** Статусы комнаты и раунда */
export type RoomStatus = 'active' | 'closed';
export type RoundStatus = 'voting' | 'revealed';

export interface Room {
  id: string;
  /** Комната может существовать без команды — тогда null */
  teamId: string | null;
  creatorId: string | null;
  name: string;
  status: RoomStatus;
  createdAt: string;
}

export interface Round {
  id: string;
  roomId: string;
  /** Порядковый номер раунда внутри комнаты, начиная с 1 */
  seq: number;
  deckType: DeckType;
  jiraUrl: string | null;
  confluenceUrl: string | null;
  status: RoundStatus;
  createdAt: string;
  revealedAt: string | null;
}

/** Участник за столом: авторизованный пользователь или гость на один сеанс */
export interface Participant {
  /** id пользователя либо сессионный id гостя */
  participantId: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  role: RoomRole;
  /** Проголосовал ли в текущем раунде; сама оценка до вскрытия не видна */
  hasVoted: boolean;
}

/** Оценка, видимая всем после вскрытия карт */
export interface RevealedVote {
  participantId: string;
  name: string;
  value: number;
}

/** Итоги раунда: считаются при вскрытии карт */
export interface RoundResult {
  average: number;
  min: number;
  max: number;
  votes: RevealedVote[];
}

/** Полный снимок комнаты — то, что видит участник */
export interface RoomState {
  room: Room;
  round: Round | null;
  participants: Participant[];
  /** Заполняется только после вскрытия карт */
  result: RoundResult | null;
}

export interface JoinRoomPayload {
  roomId: string;
  /** Имя гостя на один сеанс; авторизованным не нужно */
  guestName?: string;
  /** Сессия гостя из прошлого захода — чтобы не потерять свой голос при переподключении */
  guestSessionId?: string;
}

export interface JoinRoomResult {
  state: RoomState;
  /** Возвращается гостю: сохранить и присылать при переподключении */
  guestSessionId: string | null;
  participantId: string;
}

export interface SubmitVotePayload {
  value: number;
}

export interface StartRoundPayload {
  deckType: DeckType;
  jiraUrl?: string | null;
  confluenceUrl?: string | null;
}

export interface UpdateLinksPayload {
  jiraUrl?: string | null;
  confluenceUrl?: string | null;
}

/** Ответ на событие: либо данные, либо ошибка с тем же кодом, что и в REST */
export type WsAck<T> = { ok: true; data: T } | { ok: false; error: string; message: string };

/** Максимальная длина имени гостя и названия комнаты */
export const ROOM_NAME_MAX_LENGTH = 120;
export const GUEST_NAME_MAX_LENGTH = 60;
