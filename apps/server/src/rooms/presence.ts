import type { ParticipantProfile } from '@poker/shared';

/**
 * Кто сидит за столом с точки зрения сервера. Реестр присутствия общий с
 * досками (`PresenceRegistry` в `platform/realtime`) — домен приносит в него
 * только свой тип личности; `participantId` для реестра приходит из
 * `ParticipantProfile`.
 */
export interface ParticipantIdentity extends ParticipantProfile {
  /** id пользователя или null для гостя — по нему перепроверяются права (7.33) */
  userId: string | null;
}
