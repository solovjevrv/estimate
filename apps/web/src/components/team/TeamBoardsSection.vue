<script setup lang="ts">
import type { BoardSummary } from '@poker/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ArchiveTab } from '../../composables/use-archive-tab';
import type { PagedList } from '../../composables/use-paged-list';

defineProps<{
  canCreateBoard: boolean;
  canManageBoard: (board: BoardSummary) => boolean;
  boardsFailed: boolean;
  boardsTab: 'active' | 'archive';
  activeBoardsPaging: PagedList<BoardSummary>;
  archiveBoardsPaging: PagedList<BoardSummary>;
  boardArchive: ArchiveTab;
  unarchivingBoardId: string | null;
  formatDate: (iso: string) => string;
}>();

const emit = defineEmits<{
  selectTab: [tab: 'active' | 'archive'];
  create: [];
  unarchive: [board: BoardSummary];
  delete: [board: BoardSummary];
}>();

const { t } = useI18n();

const boardTabs = computed(() => [
  { key: 'active' as const, label: t('team.boardsActive') },
  { key: 'archive' as const, label: t('team.tabArchive') },
]);
</script>

<template>
  <div class="surface-card overflow-hidden">
    <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-[30px]">
      <h2 class="text-[17px] font-bold">{{ t('team.boardsTitle') }}</h2>
      <UButton
        v-if="canCreateBoard"
        icon="i-lucide-plus"
        class="rounded-[11px] px-[18px] py-[11px] text-sm font-bold"
        @click="emit('create')"
      >
        {{ t('board.create') }}
      </UButton>
    </div>

    <div class="flex items-center gap-2 px-4 pb-4 sm:px-[30px]">
      <button
        v-for="tab in boardTabs"
        :key="tab.key"
        type="button"
        class="rounded-full px-4 py-1.5 text-[13px] font-bold transition-colors"
        :class="
          boardsTab === tab.key
            ? 'bg-[var(--brand-primary-soft-bg)] text-[var(--brand-primary-text)]'
            : 'text-muted hover:text-default cursor-pointer'
        "
        @click="emit('selectTab', tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <UAlert
      v-if="boardsFailed"
      color="error"
      variant="subtle"
      class="mx-4 mb-5 sm:mx-[30px]"
      :description="t('team.boardsError')"
    />
    <template v-else-if="boardsTab === 'active'">
      <p
        v-if="activeBoardsPaging.total.value === 0"
        class="text-muted px-4 pb-5 sm:px-[30px] text-sm"
      >
        {{ t('team.boardsEmpty') }}
      </p>
      <RouterLink
        v-for="board in activeBoardsPaging.items.value"
        :key="board.id"
        :to="{ name: 'board', params: { id: board.id } }"
        class="border-default hover:bg-elevated/50 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[18px] sm:px-[30px]"
      >
        <span class="min-w-28 flex-1 truncate text-base font-bold">{{ board.title }}</span>
        <span class="text-muted text-sm">{{ formatDate(board.createdAt) }}</span>
      </RouterLink>
      <div
        v-if="activeBoardsPaging.total.value > activeBoardsPaging.pageSize"
        class="border-default flex justify-center border-t px-4 py-4 sm:px-[30px]"
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
        class="mx-4 mb-5 sm:mx-[30px]"
        :description="t('team.boardsError')"
      />
      <div v-if="boardArchive.loading" class="text-muted flex justify-center pb-5">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
      </div>
      <template v-else>
        <p
          v-if="archiveBoardsPaging.total.value === 0"
          class="text-muted px-4 pb-5 sm:px-[30px] text-sm"
        >
          {{ t('team.archiveBoardsEmpty') }}
        </p>
        <div
          v-for="board in archiveBoardsPaging.items.value"
          :key="board.id"
          class="border-default flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[18px] sm:px-[30px]"
        >
          <RouterLink
            :to="{ name: 'board', params: { id: board.id } }"
            class="min-w-28 flex-1 truncate text-base font-bold"
          >
            {{ board.title }}
          </RouterLink>
          <div class="flex shrink-0 items-center gap-3.5">
            <span class="text-muted text-sm">{{ formatDate(board.createdAt) }}</span>
            <template v-if="canManageBoard(board)">
              <UButton
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                size="sm"
                :loading="unarchivingBoardId === board.id"
                @click="emit('unarchive', board)"
              >
                {{ t('team.archiveUnarchiveBoard') }}
              </UButton>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                @click="emit('delete', board)"
              >
                {{ t('team.archiveDeleteBoard') }}
              </UButton>
            </template>
          </div>
        </div>
        <div
          v-if="archiveBoardsPaging.total.value > archiveBoardsPaging.pageSize"
          class="border-default flex justify-center border-t px-4 py-4 sm:px-[30px]"
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
