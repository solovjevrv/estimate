import type { ParticipantProfile } from '@poker/shared';

/** Кто сидит за столом с точки зрения сервера */
export interface ParticipantIdentity extends ParticipantProfile {
  /** id пользователя или null для гостя — по нему перепроверяются права (7.33) */
  userId: string | null;
}

/**
 * Присутствие за столом. Живёт в памяти процесса: список участников — вещь
 * сиюминутная, в базе хранятся только раунды и голоса. При нескольких
 * инстансах сюда понадобится общий адаптер (записано в Epic 8).
 */
export class RoomPresence {
  private readonly participantsByRoom = new Map<string, Map<string, ParticipantIdentity>>();
  private readonly roomBySocket = new Map<string, string>();

  join(roomId: string, socketId: string, identity: ParticipantIdentity): void {
    this.leave(socketId);
    const room = this.participantsByRoom.get(roomId) ?? new Map<string, ParticipantIdentity>();
    room.set(socketId, identity);
    this.participantsByRoom.set(roomId, room);
    this.roomBySocket.set(socketId, roomId);
  }

  /** Возвращает комнату, из которой ушёл сокет, или null — если он никуда не входил */
  leave(socketId: string): string | null {
    const roomId = this.roomBySocket.get(socketId);
    if (!roomId) {
      return null;
    }
    this.roomBySocket.delete(socketId);
    const room = this.participantsByRoom.get(roomId);
    room?.delete(socketId);
    if (room && room.size === 0) {
      this.participantsByRoom.delete(roomId);
    }
    return roomId;
  }

  roomOf(socketId: string): string | null {
    return this.roomBySocket.get(socketId) ?? null;
  }

  identityOf(socketId: string): ParticipantIdentity | null {
    const roomId = this.roomBySocket.get(socketId);
    if (!roomId) {
      return null;
    }
    return this.participantsByRoom.get(roomId)?.get(socketId) ?? null;
  }

  /** Участники комнаты без дублей: один человек мог открыть две вкладки */
  list(roomId: string): ParticipantIdentity[] {
    const room = this.participantsByRoom.get(roomId);
    if (!room) {
      return [];
    }
    const unique = new Map<string, ParticipantIdentity>();
    for (const identity of room.values()) {
      unique.set(identity.participantId, identity);
    }
    return [...unique.values()];
  }

  /**
   * Все сокеты участника в комнате — один человек мог открыть несколько вкладок,
   * и кик должен убрать его целиком, а не только одну из них.
   */
  socketIdsOf(roomId: string, participantId: string): string[] {
    const room = this.participantsByRoom.get(roomId);
    if (!room) {
      return [];
    }
    const ids: string[] = [];
    for (const [socketId, identity] of room) {
      if (identity.participantId === participantId) {
        ids.push(socketId);
      }
    }
    return ids;
  }
}
