/** REST-слой комнат: единственное место, знающее URL `/api/rooms` и коды ответов. */
import type { Room, RoomStats, RoundHistoryEntry } from '@poker/shared';
import { api } from '../../../lib/api';

export function createRoom(name: string, teamId?: string): Promise<Room> {
  return api.post<{ room: Room }>('/api/rooms', { name, teamId }).then((res) => res.room);
}

/** Комната по идентификатору — открыта по прямой ссылке, отдельных прав на просмотр нет */
export function getRoom(roomId: string): Promise<Room> {
  return api
    .get<{ room: Room }>(`/api/rooms/${encodeURIComponent(roomId)}`)
    .then((res) => res.room);
}

/** История вскрытых раундов с итогами — для страницы комнаты */
export function getRoundHistory(roomId: string): Promise<RoundHistoryEntry[]> {
  return api
    .get<{ rounds: RoundHistoryEntry[] }>(`/api/rooms/${encodeURIComponent(roomId)}/rounds`)
    .then((res) => res.rounds);
}

/** Список комнат без команды: свои личные, активные и закрытые, если archived не задан */
export function listMyRooms(archived = false): Promise<Room[]> {
  return api.get<{ rooms: Room[] }>(`/api/rooms?archived=${archived}`).then((res) => res.rooms);
}

/** Прячет комнату из основных списков, оставляя её доступной по прямой ссылке для чтения */
export function archiveRoom(roomId: string): Promise<Room> {
  return api
    .post<{ room: Room }>(`/api/rooms/${encodeURIComponent(roomId)}/archive`)
    .then((res) => res.room);
}

/** Необратимо: доступно только для уже заархивированной комнаты */
export function deleteRoom(roomId: string): Promise<void> {
  return api.delete(`/api/rooms/${encodeURIComponent(roomId)}`);
}

/** Переименовать комнату (только скрам-мастер). Доступно и для архивной комнаты. */
export function renameRoom(roomId: string, name: string): Promise<Room> {
  return api
    .patch<{ room: Room }>(`/api/rooms/${encodeURIComponent(roomId)}`, { name })
    .then((res) => res.room);
}

/** Раундов сыграно, задач оценено и среднее время раунда — по всем своим комнатам */
export function getMyRoomStats(): Promise<RoomStats> {
  return api.get<{ stats: RoomStats }>('/api/rooms/stats').then((res) => res.stats);
}
