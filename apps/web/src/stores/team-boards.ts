/** Доски команды для дашборда: активные и заархивированные. */
import type { BoardSummary } from '@poker/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { listTeamBoards } from '../features/teams/api/teams-api';

export const useTeamBoardsStore = defineStore('teamBoards', () => {
  const list = ref<BoardSummary[]>([]);
  /** Архив загружается отдельно и по требованию — не тянем его при каждом заходе на страницу */
  const archivedList = ref<BoardSummary[]>([]);
  // При переходе между командами старый HTTP-ответ не должен перезаписать новый список.
  let listGeneration = 0;
  let archiveGeneration = 0;

  async function load(teamId: string): Promise<void> {
    const requestGeneration = ++listGeneration;
    const boards = await listTeamBoards(teamId);
    if (requestGeneration === listGeneration) list.value = boards;
  }

  async function loadArchived(teamId: string): Promise<void> {
    const requestGeneration = ++archiveGeneration;
    const boards = await listTeamBoards(teamId, true);
    if (requestGeneration === archiveGeneration) archivedList.value = boards;
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
    listGeneration += 1;
    archiveGeneration += 1;
    list.value = [];
    archivedList.value = [];
  }

  return { list, active, archived, load, loadArchived, reset };
});
