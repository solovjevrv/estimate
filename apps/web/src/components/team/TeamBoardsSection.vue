<script setup lang="ts">
import type { BoardSummary } from '@estimate/shared';
import { useI18n } from 'vue-i18n';

import type { ArchiveTab } from '../../composables/use-archive-tab';
import type { PagedList } from '../../composables/use-paged-list';
import BoardGridSection from '../boards/BoardGridSection.vue';

defineProps<{
  canCreateBoard: boolean;
  canManageBoard: (board: BoardSummary) => boolean;
  boardsFailed: boolean;
  boardsTab: 'active' | 'archive';
  activeBoardsPaging: PagedList<BoardSummary>;
  archiveBoardsPaging: PagedList<BoardSummary>;
  boardArchive: ArchiveTab;
  formatDate: (iso: string) => string;
}>();

const emit = defineEmits<{
  selectTab: [tab: 'active' | 'archive'];
  create: [];
  rename: [board: BoardSummary];
  archive: [board: BoardSummary];
  unarchive: [board: BoardSummary];
  delete: [board: BoardSummary];
  retry: [];
}>();

const { t } = useI18n();
</script>

<template>
  <BoardGridSection
    :boards-failed="boardsFailed"
    :boards-tab="boardsTab"
    :active-boards-paging="activeBoardsPaging"
    :archive-boards-paging="archiveBoardsPaging"
    :board-archive="boardArchive"
    :format-date="formatDate"
    :can-manage-board="canManageBoard"
    :error-message="t('team.boardsError')"
    :empty-active-message="t('team.boardsEmpty')"
    :empty-archive-message="t('team.archiveBoardsEmpty')"
    @select-tab="emit('selectTab', $event)"
    @rename="emit('rename', $event)"
    @archive="emit('archive', $event)"
    @unarchive="emit('unarchive', $event)"
    @delete="emit('delete', $event)"
    @retry="emit('retry')"
  >
    <template #actions>
      <UButton v-if="canCreateBoard" icon="i-lucide-plus" @click="emit('create')">
        {{ t('board.create') }}
      </UButton>
    </template>
  </BoardGridSection>
</template>
