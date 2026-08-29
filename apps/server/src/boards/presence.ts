import type { BoardAccessLevel } from '@estimate/shared';

/**
 * Кто сейчас смотрит доску. Реестр присутствия общий с комнатами
 * (`PresenceRegistry` в `platform/realtime`) — домен приносит в него только
 * свой тип личности.
 */
export interface BoardParticipantIdentity {
  /** id пользователя либо сессионный id гостя — публичный, виден всем на доске */
  participantId: string;
  /** id реального аккаунта — null у гостя. Только это можно писать в created_by (FK) */
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  /** Итоговый уровень доступа этого участника к доске */
  access: BoardAccessLevel;
}
