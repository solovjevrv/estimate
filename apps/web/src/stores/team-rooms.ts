/** Комнаты команды для дашборда: активные и завершённые. Отдельно от игрового
 * стора `room.ts`, который держит состояние одного стола. */
import type { Room } from '@poker/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { api } from '../lib/api';

export const useTeamRoomsStore = defineStore('teamRooms', () => {
  const list = ref<Room[]>([]);
  /** Архив команды — виден только владельцу/администратору, грузится отдельно и по требованию */
  const archivedList = ref<Room[]>([]);

  async function load(teamId: string): Promise<void> {
    const res = await api.get<{ rooms: Room[] }>(`/api/teams/${encodeURIComponent(teamId)}/rooms`);
    list.value = res.rooms;
  }

  async function loadArchived(teamId: string): Promise<void> {
    const res = await api.get<{ rooms: Room[] }>(
      `/api/teams/${encodeURIComponent(teamId)}/rooms?archived=true`,
    );
    archivedList.value = res.rooms;
  }

  // ISO-даты сравниваются лексикографически, поэтому свежие оказываются сверху
  function byStatus(status: Room['status']): Room[] {
    return list.value
      .filter((room) => room.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const active = computed(() => byStatus('active'));
  const closed = computed(() => byStatus('closed'));
  const archived = computed(() =>
    [...archivedList.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );

  /** Уходя со страницы команды, не показываем чужой список до новой загрузки */
  function reset(): void {
    list.value = [];
    archivedList.value = [];
  }

  return { list, active, closed, archived, load, loadArchived, reset };
});
