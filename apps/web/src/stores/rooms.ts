/** Создание и архивация комнат: личных (без команды) и от лица команды. */
import type { Room } from '@poker/shared';
import { defineStore } from 'pinia';

import { api } from '../lib/api';

export const useRoomsStore = defineStore('rooms', () => {
  async function create(name: string, teamId?: string): Promise<Room> {
    const res = await api.post<{ room: Room }>('/api/rooms', { name, teamId });
    return res.room;
  }

  /** Список комнат без команды: свои личные, активные и закрытые, если archived не задан */
  async function listMine(archived = false): Promise<Room[]> {
    const res = await api.get<{ rooms: Room[] }>(`/api/rooms?archived=${archived}`);
    return res.rooms;
  }

  /** Прячет комнату из основных списков, оставляя её доступной по прямой ссылке для чтения */
  async function archive(roomId: string): Promise<Room> {
    const res = await api.post<{ room: Room }>(`/api/rooms/${encodeURIComponent(roomId)}/archive`);
    return res.room;
  }

  /** Необратимо: доступно только для уже заархивированной комнаты */
  async function remove(roomId: string): Promise<void> {
    await api.delete(`/api/rooms/${encodeURIComponent(roomId)}`);
  }

  return { create, listMine, archive, remove };
});
