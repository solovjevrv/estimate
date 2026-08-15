/** Доски команды для дашборда: активные и заархивированные. */
import type { BoardSummary } from '@poker/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { listTeamBoards } from '../features/teams/api/teams-api';

export const useTeamBoardsStore = defineStore('teamBoards', () => {
  const list = ref<BoardSummary[]>([]);
  /** Архив загружается отдельно и по требованию — не тянем его при каждом заходе на страницу */
  const archivedList = ref<BoardSummary[]>([]);

  async function load(teamId: string): Promise<void> {
    list.value = await listTeamBoards(teamId);
  }

  async function loadArchived(teamId: string): Promise<void> {
    archivedList.value = await listTeamBoards(teamId, true);
  }

  // ISO-даты сравниваются лексикографически, поэтому свежие оказываются сверху
  const active = computed(() =>
    [...list.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  const archived = computed(() =>
    [...archivedList.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );

  /** Уходя со страницы команды, не показываем чужой список до новой загрузки */
  function reset(): void {
    list.value = [];
    archivedList.value = [];
  }

  return { list, active, archived, load, loadArchived, reset };
});
