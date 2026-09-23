<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { BoardSummary } from '@estimate/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ArchiveTab } from '../../composables/use-archive-tab';
import type { PagedList } from '../../composables/use-paged-list';
import BoardCard from './BoardCard.vue';

defineProps<{
  boardsFailed: boolean;
  boardsTab: 'active' | 'archive';
  activeBoardsPaging: PagedList<BoardSummary>;
  archiveBoardsPaging: PagedList<BoardSummary>;
  boardArchive: ArchiveTab;
  formatDate: (iso: string) => string;
  /** Переименовать/заархивировать/удалить/восстановить доску может её владелец
   *  или админ команды, которой она принадлежит */
  canManageBoard: (board: BoardSummary) => boolean;
  errorMessage: string;
  emptyActiveMessage: string;
  emptyArchiveMessage: string;
  /** Плашка с именем команды у личных досок (08_Boards, «Доски — Список») — в
   *  контексте самой команды не нужна */
  teamTagFor?: (board: BoardSummary) => string | null;
}>();

const emit = defineEmits<{
  selectTab: [tab: 'active' | 'archive'];
  rename: [board: BoardSummary];
  archive: [board: BoardSummary];
  unarchive: [board: BoardSummary];
  delete: [board: BoardSummary];
  retry: [];
}>();

const { t } = useI18n();

const boardTabs = computed(() => [
  { key: 'active' as const, label: t('team.boardsActive') },
  { key: 'archive' as const, label: t('team.tabArchive') },
]);

function activeMenuItems(board: BoardSummary): DropdownMenuItem[][] {
  return [
    [{ label: t('board.rename'), icon: 'i-lucide-pencil', onSelect: () => emit('rename', board) }],
    [
      {
        label: t('board.archive'),
        icon: 'i-lucide-archive',
        color: 'error' as const,
        onSelect: () => emit('archive', board),
      },
    ],
  ];
}

function archivedMenuItems(board: BoardSummary): DropdownMenuItem[][] {
  return [
    [
      {
        label: t('board.unarchive'),
        icon: 'i-lucide-rotate-ccw',
        onSelect: () => emit('unarchive', board),
      },
    ],
    [
      {
        label: t('board.deleteBoard'),
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => emit('delete', board),
      },
    ],
  ];
}
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <button
          v-for="tab in boardTabs"
          :key="tab.key"
          type="button"
          class="cursor-pointer rounded-full px-4 py-1.5 text-xs leading-[18px] font-bold transition-colors"
          :class="
            boardsTab === tab.key
              ? 'bg-[var(--brand-primary-soft-bg)] text-[var(--brand-primary-text)]'
              : 'text-muted hover:text-default'
          "
          @click="emit('selectTab', tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>
      <slot name="actions" />
    </div>

    <UAlert
      v-if="boardsFailed"
      color="error"
      variant="subtle"
      class="mb-5"
      :description="errorMessage"
      :actions="[
        {
          label: t('common.refresh'),
          color: 'error',
          variant: 'outline',
          size: 'sm',
          onClick: () => emit('retry'),
        },
      ]"
    />
    <template v-else-if="boardsTab === 'active'">
      <p v-if="activeBoardsPaging.total.value === 0" class="text-muted pb-5 text-sm">
        {{ emptyActiveMessage }}
      </p>
      <div v-else class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <BoardCard
          v-for="board in activeBoardsPaging.items.value"
          :key="board.id"
          :board="board"
          :format-date="formatDate"
          :team-tag="teamTagFor?.(board) ?? null"
          :menu-items="canManageBoard(board) ? activeMenuItems(board) : undefined"
          :menu-aria-label="t('board.boardMenu')"
        />
      </div>
      <div
        v-if="activeBoardsPaging.total.value > activeBoardsPaging.pageSize"
        class="border-default flex justify-center border-t px-4 py-4 sm:px-8"
      >
        <!-- eslint-disable vue/no-mutating-props -- `page` — общая Ref-ячейка
             composable'а usePagedList, а не сам объект prop-а; перетаскивание
             страницы в родителе работает так же -->
        <UPagination
          v-model:page="activeBoardsPaging.page.value"
          :total="activeBoardsPaging.total.value"
          :items-per-page="activeBoardsPaging.pageSize"
        />
        <!-- eslint-enable vue/no-mutating-props -->
      </div>
    </template>
    <template v-else>
      <UAlert
        v-if="boardArchive.failed"
        color="error"
        variant="subtle"
        class="mb-5"
        :description="t('team.boardsError')"
      />
      <div v-else-if="boardArchive.loading" class="text-muted flex justify-center pb-5">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
      </div>
      <template v-else>
        <p v-if="archiveBoardsPaging.total.value === 0" class="text-muted pb-5 text-sm">
          {{ emptyArchiveMessage }}
        </p>
        <div v-else class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <BoardCard
            v-for="board in archiveBoardsPaging.items.value"
            :key="board.id"
            :board="board"
            :format-date="formatDate"
            :team-tag="teamTagFor?.(board) ?? null"
            :menu-items="canManageBoard(board) ? archivedMenuItems(board) : undefined"
            :menu-aria-label="t('board.boardMenu')"
          />
        </div>
        <div
          v-if="archiveBoardsPaging.total.value > archiveBoardsPaging.pageSize"
          class="border-default flex justify-center border-t px-4 py-4 sm:px-8"
        >
          <!-- eslint-disable vue/no-mutating-props -- см. пояснение выше -->
          <UPagination
            v-model:page="archiveBoardsPaging.page.value"
            :total="archiveBoardsPaging.total.value"
            :items-per-page="archiveBoardsPaging.pageSize"
          />
          <!-- eslint-enable vue/no-mutating-props -->
        </div>
      </template>
    </template>
  </div>
</template>
