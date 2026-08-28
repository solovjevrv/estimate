<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables';
import { BOARD_TITLE_MAX_LENGTH, type BoardSummary } from '@estimate/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import ConfirmModal from '../components/ConfirmModal.vue';
import EntityTextModal from '../components/EntityTextModal.vue';
import { useArchiveTab } from '../composables/use-archive-tab';
import { usePagedList } from '../composables/use-paged-list';
import { useAsyncAction } from '../composables/use-async-action';
import { useEntityModal } from '../composables/use-entity-modal';
import {
  createBoard as createBoardRequest,
  deleteBoard,
  listMyBoards,
  unarchiveBoard,
} from '../features/boards/api/boards-api';

const { t, locale } = useI18n();
const router = useRouter();
const toast = useToast();

const loading = ref(true);
const loadFailed = ref(false);
const list = ref<BoardSummary[]>([]);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value);
}

// ISO-даты сравниваются лексикографически, поэтому свежие оказываются сверху
const activeBoards = computed(() =>
  [...list.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);
const activePaging = usePagedList(activeBoards);

onMounted(load);

async function load(): Promise<void> {
  loading.value = true;
  loadFailed.value = false;
  try {
    list.value = await listMyBoards(false);
    activePaging.reset();
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

// --- Создание доски ---
const createBoardModal = useEntityModal();

const { pending: creating, execute: createBoard } = useAsyncAction({
  run: (title: string) => createBoardRequest(title),
  success: async (board) => {
    createBoardModal.close();
    await router.push({ name: 'board', params: { id: board.id } });
  },
  error: () => {
    toast.add({ title: t('board.createError'), color: 'error' });
  },
});

async function onCreateBoard(title: string): Promise<void> {
  await createBoard(title);
}

// --- Архив: грузится отдельно и по требованию, чтобы не тянуть его при каждом заходе ---
const archived = ref<BoardSummary[]>([]);
const archivedComputed = computed(() => archived.value);
const archivePaging = usePagedList(archivedComputed);
const archive = useArchiveTab(async () => {
  archived.value = await listMyBoards(true);
}, archivePaging.reset);

const unarchivingId = ref<string | null>(null);

async function unarchive(board: BoardSummary): Promise<void> {
  unarchivingId.value = board.id;
  try {
    const updated = await unarchiveBoard(board.id);
    archived.value = archived.value.filter((b) => b.id !== board.id);
    // Возвращаем в основной список, не только убираем из архивного — иначе доска
    // пропадала бы из обоих списков до перезагрузки страницы
    list.value = [...list.value, { ...board, ...updated }];
    toast.add({ title: t('boards.unarchived'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('boards.unarchiveError'), color: 'error' });
  } finally {
    unarchivingId.value = null;
  }
}

const deleteTarget = ref<BoardSummary | null>(null);
const deleteOpen = ref(false);

function askDelete(board: BoardSummary): void {
  deleteTarget.value = board;
  deleteOpen.value = true;
}

const { pending: deleting, execute: removeBoard } = useAsyncAction({
  run: (target: BoardSummary) => deleteBoard(target.id),
  success: (_, target) => {
    archived.value = archived.value.filter((board) => board.id !== target.id);
    toast.add({ title: t('boards.deleted'), color: 'success', icon: 'i-lucide-check' });
    deleteOpen.value = false;
  },
  error: () => {
    toast.add({ title: t('boards.deleteError'), color: 'error' });
  },
});

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;
  await removeBoard(target);
}
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="font-heading text-3xl font-extrabold">{{ t('boards.title') }}</h1>
      <UButton
        icon="i-lucide-plus"
        class="h-[43px] px-[22px] text-[15px] font-bold"
        @click="createBoardModal.show"
      >
        {{ t('board.create') }}
      </UButton>
    </div>

    <UAlert v-if="loadFailed" color="error" variant="subtle" :description="t('boards.loadError')" />

    <div v-else-if="loading" class="surface-card overflow-hidden">
      <div
        v-for="i in 3"
        :key="i"
        class="border-default flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[22px] first:border-t-0 sm:px-[30px]"
      >
        <USkeleton class="h-5 w-1/3 bg-[var(--brand-border)]" />
        <USkeleton class="h-5 w-20 rounded-full bg-[var(--brand-border)]" />
      </div>
    </div>

    <template v-else>
      <p v-if="list.length === 0" class="surface-card text-muted p-4 text-sm sm:p-[30px]">
        {{ t('boards.empty') }}
      </p>
      <div v-else class="surface-card overflow-hidden">
        <RouterLink
          v-for="board in activePaging.items.value"
          :key="board.id"
          :to="{ name: 'board', params: { id: board.id } }"
          class="border-default hover:bg-elevated/50 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[22px] first:border-t-0 sm:px-[30px]"
        >
          <span class="min-w-28 flex-1 truncate text-[17px] font-bold">{{ board.title }}</span>
          <div class="flex shrink-0 items-center gap-3.5">
            <span v-if="board.teamId" class="badge-pill badge-pill-neutral">{{
              t('boards.teamBadge')
            }}</span>
            <span class="text-muted text-sm">{{ formatDate(board.createdAt) }}</span>
          </div>
        </RouterLink>
        <div
          v-if="activePaging.total.value > activePaging.pageSize"
          class="border-default flex justify-center border-t px-4 py-4 sm:px-[30px]"
        >
          <UPagination
            v-model:page="activePaging.page.value"
            :total="activePaging.total.value"
            :items-per-page="activePaging.pageSize"
          />
        </div>
      </div>

      <div class="surface-card overflow-hidden">
        <div class="flex items-center justify-between gap-3 px-4 py-5 sm:px-[30px]">
          <h2 class="text-[17px] font-bold">{{ t('boards.archiveTitle') }}</h2>
          <button
            type="button"
            class="text-primary cursor-pointer text-sm font-bold"
            @click="archive.toggle"
          >
            {{ archive.open ? t('boards.archiveHide') : t('boards.archiveShow') }}
          </button>
        </div>

        <template v-if="archive.open">
          <UAlert
            v-if="archive.failed"
            color="error"
            variant="subtle"
            class="mx-4 mb-5 sm:mx-[30px]"
            :description="t('boards.archiveError')"
          />
          <div v-else-if="archive.loading" class="text-muted flex justify-center pb-5">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          </div>
          <p
            v-else-if="archivePaging.total.value === 0"
            class="text-muted px-4 pb-5 text-sm sm:px-[30px]"
          >
            {{ t('boards.archiveEmpty') }}
          </p>
          <template v-else>
            <div
              v-for="board in archivePaging.items.value"
              :key="board.id"
              class="border-default flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[18px] sm:px-[30px]"
            >
              <RouterLink
                :to="{ name: 'board', params: { id: board.id } }"
                class="min-w-28 flex-1 truncate text-[15.5px] font-bold"
              >
                {{ board.title }}
              </RouterLink>
              <div class="flex shrink-0 items-center gap-3">
                <span v-if="board.teamId" class="badge-pill badge-pill-neutral">{{
                  t('boards.teamBadge')
                }}</span>
                <span class="text-muted text-[13.5px]">{{ formatDate(board.createdAt) }}</span>
                <UButton
                  icon="i-lucide-rotate-ccw"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :loading="unarchivingId === board.id"
                  @click="unarchive(board)"
                >
                  {{ t('boards.unarchive') }}
                </UButton>
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="sm"
                  @click="askDelete(board)"
                >
                  {{ t('boards.deleteBoard') }}
                </UButton>
              </div>
            </div>
            <div
              v-if="archivePaging.total.value > archivePaging.pageSize"
              class="border-default flex justify-center border-t px-4 py-4 sm:px-[30px]"
            >
              <UPagination
                v-model:page="archivePaging.page.value"
                :total="archivePaging.total.value"
                :items-per-page="archivePaging.pageSize"
              />
            </div>
          </template>
        </template>
      </div>
    </template>

    <EntityTextModal
      v-model:open="createBoardModal.open"
      :title="t('board.createTitle')"
      :label="t('common.nameLabel')"
      :placeholder="t('board.createNamePlaceholder')"
      :max-length="BOARD_TITLE_MAX_LENGTH"
      :required-message="t('common.nameRequired')"
      :too-long-message="t('common.nameTooLong', { max: BOARD_TITLE_MAX_LENGTH })"
      :cancel-label="t('common.cancel')"
      :submit-label="creating ? t('board.creating') : t('board.create')"
      :pending="creating"
      @submit="onCreateBoard"
    />

    <ConfirmModal
      v-model:open="deleteOpen"
      :title="t('boards.deleteConfirmTitle')"
      :description="t('boards.deleteConfirmText', { name: deleteTarget?.title ?? '' })"
      :confirm-label="t('boards.deleteConfirm')"
      :loading="deleting"
      @confirm="confirmDelete"
    />
  </section>
</template>
