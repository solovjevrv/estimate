/** Создание комнат: личных (без команды) и от лица команды. */
import type { Room } from '@poker/shared';
import { defineStore } from 'pinia';

import { api } from '../lib/api';

export const useRoomsStore = defineStore('rooms', () => {
  async function create(name: string, teamId?: string): Promise<Room> {
    const res = await api.post<{ room: Room }>('/api/rooms', { name, teamId });
    return res.room;
  }

  return { create };
});
