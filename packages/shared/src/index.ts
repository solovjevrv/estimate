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

/** Роли участника внутри команды */
export type TeamRole = 'owner' | 'admin' | 'member' | 'guest';

/** Роли участника внутри комнаты */
export type RoomRole = 'scrum_master' | 'voter';

/** Типы колод для оценки */
export type DeckType = 'fibonacci' | 'scale_0_5';

export const FIBONACCI_DECK: readonly number[] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

export const SCALE_0_5_DECK: readonly number[] = [0, 1, 2, 3, 4, 5];
