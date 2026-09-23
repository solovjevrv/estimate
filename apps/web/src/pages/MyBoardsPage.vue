<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables';
import { BOARD_TITLE_MAX_LENGTH, hasTeamRole, type BoardSummary } from '@estimate/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import BoardGridSection from '../components/boards/BoardGridSection.vue';
import ConfirmModal from '../components/ConfirmModal.vue';
import EntityTextModal from '../components/EntityTextModal.vue';
import { useArchiveTab } from '../composables/use-archive-tab';
import { usePagedList } from '../composables/use-paged-list';
import { useAsyncAction } from '../composables/use-async-action';
import { useEntityModal } from '../composables/use-entity-modal';
import {
  archiveBoard as archiveBoardRequest,
  createBoard as createBoardRequest,
  deleteBoard,
  listMyBoards,
  renameBoard as renameBoardRequest,
  unarchiveBoard as unarchiveBoardRequest,
} from '../features/boards/api/boards-api';
import { useSessionStore } from '../stores/session';
import { useTeamsStore } from '../stores/teams';

const { t, locale } = useI18n();
const router = useRouter();
const toast = useToast();
const session = useSessionStore();
const teams = useTeamsStore();

const loading = ref(true);
const loadFailed = ref(false);
const list = ref<BoardSummary[]>([]);

const currentUserId = computed(() => session.user?.id ?? null);
const teamRoleById = computed(() => new Map(teams.list.map((team) => [team.id, team.role])));
const teamNameById = computed(() => new Map(teams.list.map((team) => [team.id, team.name])));

/** Переименовать/заархивировать/удалить/восстановить доску может её владелец или
 *  админ команды, которой она принадлежит — тот же принцип, что и у комнат
 *  (canManageRoom, 20.3.4b) */
function canManageBoard(board: BoardSummary): boolean {
  if (board.ownerId === currentUserId.value) return true;
  if (!board.teamId) return false;
  const role = teamRoleById.value.get(board.teamId);
  return !!role && hasTeamRole(role, 'admin');
}

function teamTagFor(board: BoardSummary): string | null {
  return board.teamId ? (teamNameById.value.get(board.teamId) ?? null) : null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value);
}

// --- Вкладки «Активные»/«Архив» (08_Boards: та же пара пилюль, что на странице команды) ---
const boardsTab = ref<'active' | 'archive'>('active');
// ISO-даты сравниваются лексикографически, поэтому свежие оказываются сверху
const activeBoards = computed(() =>
  [...list.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);
const activeBoardsPaging = usePagedList(activeBoards);

const archived = ref<BoardSummary[]>([]);
const archivedSorted = computed(() =>
  [...archived.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);
const archiveBoardsPaging = usePagedList(archivedSorted);
const boardArchive = useArchiveTab(async () => {
  archived.value = await listMyBoards(true);
}, archiveBoardsPaging.reset);

async function selectBoardsTab(tab: 'active' | 'archive'): Promise<void> {
  boardsTab.value = tab;
  if (tab === 'archive') await boardArchive.activate();
}

onMounted(load);

async function load(): Promise<void> {
  loading.value = true;
  loadFailed.value = false;
  boardsTab.value = 'active';
  boardArchive.reset();
  activeBoardsPaging.reset();
  archiveBoardsPaging.reset();
  try {
    list.value = await listMyBoards(false);
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
  try {
    await teams.loadList();
  } catch {
    // Плашка команды и права по ней — необязательная деталь карточки; при сбое
    // остаётся доступной только собственная доска (ownerId)
  }
}

/** Обновляет и активный, и заархивированный список — переименованная/заархивированная
 * доска может быть на любой из двух вкладок; сбой тихой довозгрузки архива не должен
 * превращать успешное действие в error-тост. */
async function reloadBoardsAfterMutation(): Promise<void> {
  try {
    list.value = await listMyBoards(false);
  } catch {
    loadFailed.value = true;
  }
  try {
    archived.value = await listMyBoards(true);
  } catch {
    // Архив обновится при следующем открытии вкладки — не критично
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

// --- Переименование ---
const renameBoardTarget = ref<BoardSummary | null>(null);
const renameBoardModal = useEntityModal();

function askRenameBoard(board: BoardSummary): void {
  renameBoardTarget.value = board;
  renameBoardModal.show();
}

const { pending: renamingBoard, execute: renameBoard } = useAsyncAction({
  run: (title: string) => {
    const target = renameBoardTarget.value;
    if (!target) return Promise.reject(new Error('no rename target'));
    return renameBoardRequest(target.id, title);
  },
  success: async () => {
    renameBoardModal.close();
    toast.add({ title: t('board.renamed'), color: 'success', icon: 'i-lucide-check' });
    await reloadBoardsAfterMutation();
  },
  error: () => {
    toast.add({ title: t('board.renameError'), color: 'error' });
  },
});

async function onRenameBoard(title: string): Promise<void> {
  if (!renameBoardTarget.value) return;
  await renameBoard(title);
}

// --- Архивация ---
const archiveBoardTarget = ref<BoardSummary | null>(null);
const archiveBoardOpen = ref(false);

function askArchiveBoard(board: BoardSummary): void {
  archiveBoardTarget.value = board;
  archiveBoardOpen.value = true;
}

const { pending: archivingBoard, execute: archiveBoard } = useAsyncAction({
  run: (target: BoardSummary) => archiveBoardRequest(target.id),
  success: async () => {
    archiveBoardOpen.value = false;
    toast.add({ title: t('board.archivedToast'), color: 'success', icon: 'i-lucide-check' });
    await reloadBoardsAfterMutation();
  },
  error: () => {
    toast.add({ title: t('board.archiveError'), color: 'error' });
  },
});

async function confirmArchiveBoard(): Promise<void> {
  const target = archiveBoardTarget.value;
  if (!target) return;
  await archiveBoard(target);
}

// --- Восстановление из архива ---
async function unarchiveBoard(board: BoardSummary): Promise<void> {
  try {
    const updated = await unarchiveBoardRequest(board.id);
    archived.value = archived.value.filter((b) => b.id !== board.id);
    // Возвращаем в основной список, а не только убираем из архивного — иначе доска
    // пропадала бы из обоих списков до перезагрузки страницы
    list.value = [...list.value, { ...board, ...updated }];
    toast.add({ title: t('boards.unarchived'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('boards.unarchiveError'), color: 'error' });
  }
}

// --- Удаление (доступно только для уже заархивированной доски) ---
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
      <h1 class="font-heading text-[32px] font-bold">{{ t('boards.title') }}</h1>
      <UButton icon="i-lucide-plus" size="lg" @click="createBoardModal.show">
        {{ t('board.create') }}
      </UButton>
    </div>

    <UAlert
      v-if="loadFailed"
      color="error"
      variant="subtle"
      :description="t('boards.loadError')"
      :actions="[
        {
          label: t('common.refresh'),
          color: 'error',
          variant: 'outline',
          size: 'sm',
          onClick: load,
        },
      ]"
    />

    <div v-else-if="loading" class="space-y-5">
      <p class="text-muted text-sm">{{ t('boards.subtitle') }}</p>
      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="i in 3" :key="i" class="overflow-hidden rounded-r24">
          <USkeleton class="h-[140px] w-full rounded-none bg-border-medium" />
          <div class="surface-card space-y-2 rounded-t-none px-5 py-4">
            <USkeleton class="h-5 w-2/3 bg-border-medium" />
            <USkeleton class="h-4 w-1/3 bg-border-medium" />
          </div>
        </div>
      </div>
    </div>

    <template v-else>
      <p class="text-muted text-sm">{{ t('boards.subtitle') }}</p>

      <BoardGridSection
        :boards-failed="false"
        :boards-tab="boardsTab"
        :active-boards-paging="activeBoardsPaging"
        :archive-boards-paging="archiveBoardsPaging"
        :board-archive="boardArchive"
        :format-date="formatDate"
        :can-manage-board="canManageBoard"
        :team-tag-for="teamTagFor"
        :error-message="t('boards.loadError')"
        :empty-active-message="t('boards.empty')"
        :empty-archive-message="t('boards.archiveEmpty')"
        @select-tab="selectBoardsTab"
        @rename="askRenameBoard"
        @archive="askArchiveBoard"
        @unarchive="unarchiveBoard"
        @delete="askDelete"
        @retry="load"
      />
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

    <EntityTextModal
      v-model:open="renameBoardModal.open"
      :title="t('board.renameTitle')"
      :label="t('common.nameLabel')"
      :placeholder="t('board.createNamePlaceholder')"
      :initial-value="renameBoardTarget?.title ?? ''"
      :max-length="BOARD_TITLE_MAX_LENGTH"
      :required-message="t('common.nameRequired')"
      :too-long-message="t('common.nameTooLong', { max: BOARD_TITLE_MAX_LENGTH })"
      :cancel-label="t('common.cancel')"
      :submit-label="t('board.rename')"
      :pending="renamingBoard"
      @submit="onRenameBoard"
    />

    <ConfirmModal
      v-model:open="archiveBoardOpen"
      :title="t('board.archiveConfirmTitle')"
      :description="t('board.archiveConfirmText')"
      :confirm-label="t('board.archiveConfirm')"
      :loading="archivingBoard"
      @confirm="confirmArchiveBoard"
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
