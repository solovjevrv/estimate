<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables';
import {
  BOARD_TITLE_MAX_LENGTH,
  hasTeamRole,
  ROOM_NAME_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  TEAM_ROLES,
  type BoardSummary,
  type Room,
  type TeamMember,
  type TeamRole,
} from '@estimate/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import ConfirmModal from '../components/ConfirmModal.vue';
import EntityTextModal from '../components/EntityTextModal.vue';
import TeamBoardsSection from '../components/team/TeamBoardsSection.vue';
import TeamMembersSection from '../components/team/TeamMembersSection.vue';
import TeamRoomsSection from '../components/team/TeamRoomsSection.vue';
import TeamSettingsSection from '../components/team/TeamSettingsSection.vue';
import { useArchiveTab } from '../composables/use-archive-tab';
import { usePagedList } from '../composables/use-paged-list';
import { useAsyncAction } from '../composables/use-async-action';
import { useEntityModal } from '../composables/use-entity-modal';
import { ApiError } from '../lib/api';
import { roleBadgeColor } from '../lib/team-roles';
import {
  createBoard as createBoardRequest,
  deleteBoard as deleteBoardRequest,
  unarchiveBoard as unarchiveBoardRequest,
} from '../features/boards/api/boards-api';
import {
  createRoom as createRoomRequest,
  deleteRoom as deleteRoomRequest,
} from '../features/rooms/api/rooms-api';
import { useSessionStore } from '../stores/session';
import { useTeamBoardsStore } from '../stores/team-boards';
import { useTeamRoomsStore } from '../stores/team-rooms';
import { useTeamsStore } from '../stores/teams';

const props = defineProps<{ id: string }>();

const { t, locale } = useI18n();
const toast = useToast();
const router = useRouter();
const teams = useTeamsStore();
const teamRooms = useTeamRoomsStore();
const teamBoards = useTeamBoardsStore();
const session = useSessionStore();

const loading = ref(true);
const notFound = ref(false);
const loadFailed = ref(false);
/** Комнаты грузятся отдельно: их сбой не должен прятать саму команду */
const roomsFailed = ref(false);
/** Доски грузятся отдельно: их сбой не должен прятать саму команду */
const boardsFailed = ref(false);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value);
}

const overview = computed(() => teams.current);
const currentUserId = computed(() => session.user?.id ?? null);
/**
 * Роль admin — единственная с расширенными правами (создание комнат, состав,
 * роли, переименование, удаление команды). Администраторов может быть несколько.
 */
const canManageTeam = computed(() => !!overview.value && hasTeamRole(overview.value.role, 'admin'));
/** Заводить доски команды может участник или администратор, не гость (12.1) */
const canCreateBoard = computed(
  () => !!overview.value && hasTeamRole(overview.value.role, 'member'),
);

function canManageBoard(board: BoardSummary): boolean {
  return canManageTeam.value || board.ownerId === currentUserId.value;
}

/** Пока идёт запрос по участнику — блокируем его элементы управления. Набор, а
 * не один id: операции по разным участникам могут идти внахлёст. */
const busyUsers = ref<Set<string>>(new Set());

function isBusy(userId: string): boolean {
  return busyUsers.value.has(userId);
}

// Замена ссылки, а не мутация Set: так реактивность срабатывает без лишних хлопот
function setBusy(userId: string, busy: boolean): void {
  const next = new Set(busyUsers.value);
  if (busy) next.add(userId);
  else next.delete(userId);
  busyUsers.value = next;
}

const roleItems = computed(() =>
  TEAM_ROLES.map((role) => ({ label: t(`role.${role}`), value: role })),
);

/** «Архив» объединяет завершённые (видны всем) и по-настоящему заархивированные
 * (видны только администратору) — они не пересекаются на бэкенде: список
 * `teamRooms.list` вообще не включает заархивированные комнаты. */
const archiveTabRooms = computed(() =>
  [...teamRooms.closed, ...teamRooms.archived].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  ),
);
const activeRoomsPaging = usePagedList(computed(() => teamRooms.active));
const archiveTabPaging = usePagedList(archiveTabRooms);

const activeBoardsPaging = usePagedList(computed(() => teamBoards.active));
const archiveBoardsPaging = usePagedList(computed(() => teamBoards.archived));

/** Код приходит только администратору — по нему и показываем блок приглашения */
const inviteUrl = computed(() =>
  overview.value?.inviteCode
    ? `${window.location.origin}/invite/${overview.value.inviteCode}`
    : null,
);

// --- Таб «Архив»: заархивированная часть видна только администратору, грузится
// по требованию — обычный участник видит в этом табе только завершённые комнаты ---
const roomsTab = ref<'active' | 'archive'>('active');
const boardsTab = ref<'active' | 'archive'>('active');
const roomArchive = useArchiveTab(() => teamRooms.loadArchived(props.id), archiveTabPaging.reset);
const boardArchive = useArchiveTab(
  () => teamBoards.loadArchived(props.id),
  archiveBoardsPaging.reset,
);

// immediate — грузим при заходе; watch — на случай перехода между командами,
// когда vue-router переиспользует компонент и onMounted повторно не срабатывает
watch(() => props.id, load, { immediate: true });

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  loadFailed.value = false;
  roomsFailed.value = false;
  roomsTab.value = 'active';
  roomArchive.reset();
  teamRooms.reset();
  activeRoomsPaging.reset();
  archiveTabPaging.reset();
  boardsFailed.value = false;
  boardsTab.value = 'active';
  boardArchive.reset();
  teamBoards.reset();
  activeBoardsPaging.reset();
  archiveBoardsPaging.reset();
  try {
    await teams.loadTeam(props.id);
    // Дашборд команды: комнаты и доски тянем следом, их ошибки ловим отдельно ниже
    await Promise.all([loadRooms(), loadBoards()]);
  } catch (err) {
    // Посторонним и на несуществующую команду сервер отвечает одинаково — 404
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true;
    } else {
      loadFailed.value = true;
    }
  } finally {
    loading.value = false;
  }
}

async function loadRooms(): Promise<void> {
  try {
    await teamRooms.load(props.id);
  } catch {
    roomsFailed.value = true;
  }
}

async function loadBoards(): Promise<void> {
  try {
    await teamBoards.load(props.id);
  } catch {
    boardsFailed.value = true;
  }
}

async function selectRoomsTab(tab: 'active' | 'archive'): Promise<void> {
  roomsTab.value = tab;
  if (tab === 'archive' && canManageTeam.value) await roomArchive.activate();
}

// Архив досок, в отличие от архива комнат, доступен на чтение любому участнику
// команды — сервер (`listForTeam`) не сужает его до администратора (12.1)
async function selectBoardsTab(tab: 'active' | 'archive'): Promise<void> {
  boardsTab.value = tab;
  if (tab === 'archive') await boardArchive.activate();
}

const deleteRoomTarget = ref<Room | null>(null);
const deleteRoomOpen = ref(false);

function askDeleteRoom(room: Room): void {
  deleteRoomTarget.value = room;
  deleteRoomOpen.value = true;
}

const { pending: deletingRoom, execute: deleteRoom } = useAsyncAction({
  run: (target: Room) => deleteRoomRequest(target.id),
  success: async () => {
    await teamRooms.loadArchived(props.id);
    toast.add({ title: t('team.archiveDeleted'), color: 'success', icon: 'i-lucide-check' });
    deleteRoomOpen.value = false;
  },
  error: () => {
    toast.add({ title: t('team.archiveDeleteError'), color: 'error' });
  },
});

async function confirmDeleteRoom(): Promise<void> {
  const target = deleteRoomTarget.value;
  if (!target) return;
  await deleteRoom(target);
}

// --- Создание комнаты от лица команды ---
const createRoomModal = useEntityModal();

const { pending: creatingRoom, execute: createTeamRoom } = useAsyncAction({
  run: (name: string) => createRoomRequest(name, props.id),
  success: async (room) => {
    createRoomModal.close();
    await router.push({ name: 'room', params: { id: room.id } });
  },
  error: () => {
    toast.add({ title: t('room.createError'), color: 'error' });
  },
});

async function onCreateRoom(name: string): Promise<void> {
  await createTeamRoom(name);
}

// --- Создание доски от лица команды ---
const createBoardModal = useEntityModal();

const { pending: creatingBoard, execute: createTeamBoard } = useAsyncAction({
  run: (title: string) => createBoardRequest(title, props.id),
  success: async (board) => {
    createBoardModal.close();
    await router.push({ name: 'board', params: { id: board.id } });
  },
  error: () => {
    toast.add({ title: t('board.createError'), color: 'error' });
  },
});

async function onCreateBoard(title: string): Promise<void> {
  await createTeamBoard(title);
}

const unarchivingBoardId = ref<string | null>(null);

async function unarchiveBoard(board: BoardSummary): Promise<void> {
  unarchivingBoardId.value = board.id;
  try {
    await unarchiveBoardRequest(board.id);
    await Promise.all([teamBoards.load(props.id), teamBoards.loadArchived(props.id)]);
    toast.add({
      title: t('team.archiveBoardUnarchived'),
      color: 'success',
      icon: 'i-lucide-check',
    });
  } catch {
    toast.add({ title: t('team.archiveBoardUnarchiveError'), color: 'error' });
  } finally {
    unarchivingBoardId.value = null;
  }
}

const deleteBoardTarget = ref<BoardSummary | null>(null);
const deleteBoardOpen = ref(false);

function askDeleteBoard(board: BoardSummary): void {
  deleteBoardTarget.value = board;
  deleteBoardOpen.value = true;
}

const { pending: deletingBoard, execute: deleteTeamBoard } = useAsyncAction({
  run: (target: BoardSummary) => deleteBoardRequest(target.id),
  success: async () => {
    await teamBoards.loadArchived(props.id);
    toast.add({ title: t('team.archiveBoardDeleted'), color: 'success', icon: 'i-lucide-check' });
    deleteBoardOpen.value = false;
  },
  error: () => {
    toast.add({ title: t('team.archiveBoardDeleteError'), color: 'error' });
  },
});

async function confirmDeleteBoard(): Promise<void> {
  const target = deleteBoardTarget.value;
  if (!target) return;
  await deleteTeamBoard(target);
}

const rotateOpen = ref(false);

const { pending: rotating, execute: rotateInvite } = useAsyncAction({
  run: () => teams.rotateInvite(props.id),
  success: () => {
    toast.add({ title: t('team.rotated'), color: 'success', icon: 'i-lucide-check' });
    rotateOpen.value = false;
  },
  error: () => {
    toast.add({ title: t('team.rotateError'), color: 'error' });
  },
});

async function rotate(): Promise<void> {
  await rotateInvite();
}

// --- Смена роли ---
async function onRoleChange(member: TeamMember, role: TeamRole): Promise<void> {
  if (role === member.role) return;
  await applyRole(member.userId, role);
}

async function applyRole(userId: string, role: TeamRole): Promise<void> {
  setBusy(userId, true);
  try {
    await teams.changeMemberRole(props.id, userId, role);
    toast.add({ title: t('team.roleChanged'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('team.roleChangeError'), color: 'error' });
  } finally {
    setBusy(userId, false);
  }
}

// --- Исключение участника ---
const removeTarget = ref<TeamMember | null>(null);
const removeOpen = ref(false);

function askRemove(member: TeamMember): void {
  removeTarget.value = member;
  removeOpen.value = true;
}

async function confirmRemove(): Promise<void> {
  const target = removeTarget.value;
  if (!target) return;
  setBusy(target.userId, true);
  try {
    await teams.removeMember(props.id, target.userId);
    toast.add({ title: t('team.removed'), color: 'success', icon: 'i-lucide-check' });
    removeOpen.value = false;
  } catch {
    toast.add({ title: t('team.removeError'), color: 'error' });
  } finally {
    setBusy(target.userId, false);
  }
}

// --- Собственный выход из команды ---
const leaveOpen = ref(false);

const { pending: leaving, execute: leave } = useAsyncAction<[string], void>({
  run: (userId: string) => teams.removeMember(props.id, userId),
  success: async () => {
    toast.add({ title: t('team.left'), color: 'success', icon: 'i-lucide-check' });
    leaveOpen.value = false;
    await router.push({ name: 'teams' });
  },
  error: (err) => {
    // Единственному администратору бэкенд отвечает 409 — сначала назначить другого
    const key = err instanceof ApiError && err.status === 409 ? 'leaveLastAdmin' : 'leaveError';
    toast.add({ title: t(`team.${key}`), color: 'error' });
  },
});

async function confirmLeave(): Promise<void> {
  const userId = currentUserId.value;
  if (!userId) return;
  await leave(userId);
}

// --- Переименование ---
const renameModal = useEntityModal();

const { pending: renaming, execute: renameTeam } = useAsyncAction({
  run: (name: string) => teams.rename(props.id, name),
  success: () => {
    toast.add({ title: t('team.renamed'), color: 'success', icon: 'i-lucide-check' });
    renameModal.close();
  },
  error: () => {
    toast.add({ title: t('team.renameError'), color: 'error' });
  },
});

async function onRename(name: string): Promise<void> {
  await renameTeam(name);
}

// --- Удаление команды ---
const deleteOpen = ref(false);

const { pending: deleting, execute: deleteTeam } = useAsyncAction({
  run: () => teams.remove(props.id),
  success: async () => {
    toast.add({ title: t('team.deleted'), color: 'success', icon: 'i-lucide-check' });
    deleteOpen.value = false;
    await router.push({ name: 'teams' });
  },
  error: () => {
    toast.add({ title: t('team.deleteError'), color: 'error' });
  },
});

async function confirmDelete(): Promise<void> {
  await deleteTeam();
}
</script>

<template>
  <section class="space-y-5">
    <RouterLink
      :to="{ name: 'teams' }"
      class="text-muted hover:text-default inline-flex w-fit items-center gap-1.5 text-[14.5px] font-semibold"
    >
      <UIcon name="i-lucide-chevron-left" class="size-4" />
      {{ t('team.back') }}
    </RouterLink>

    <UAlert v-if="notFound" color="error" variant="subtle" :description="t('team.notFound')" />
    <UAlert
      v-else-if="loadFailed"
      color="error"
      variant="subtle"
      :description="t('team.loadError')"
    />

    <div v-else-if="loading" class="space-y-5">
      <USkeleton class="h-9 w-1/3 bg-[var(--brand-border)]" />
      <div class="surface-card space-y-4 px-4 py-5 sm:px-[30px] sm:py-[26px]">
        <USkeleton class="h-5 w-1/4 bg-[var(--brand-border)]" />
        <USkeleton class="h-14 w-full rounded-[12px] bg-[var(--brand-border)]" />
        <USkeleton class="h-14 w-full rounded-[12px] bg-[var(--brand-border)]" />
      </div>
      <div class="surface-card space-y-4 px-4 py-5 sm:px-[30px] sm:py-[26px]">
        <USkeleton class="h-5 w-1/4 bg-[var(--brand-border)]" />
        <USkeleton class="h-10 w-full rounded-[12px] bg-[var(--brand-border)]" />
      </div>
    </div>

    <template v-else-if="overview">
      <div class="flex flex-wrap items-center gap-3.5">
        <h1 class="font-heading min-w-0 text-3xl font-extrabold break-words">
          {{ overview.team.name }}
        </h1>
        <span
          class="badge-pill"
          :class="
            roleBadgeColor(overview.role) === 'primary'
              ? 'badge-pill-primary'
              : 'badge-pill-neutral'
          "
        >
          {{ t(`role.${overview.role}`) }}
        </span>
      </div>

      <TeamRoomsSection
        :can-manage-team="canManageTeam"
        :rooms-failed="roomsFailed"
        :rooms-tab="roomsTab"
        :active-rooms-paging="activeRoomsPaging"
        :archive-tab-paging="archiveTabPaging"
        :room-archive="roomArchive"
        :format-date="formatDate"
        @select-tab="selectRoomsTab"
        @create="createRoomModal.show"
        @delete="askDeleteRoom"
      />

      <TeamBoardsSection
        :can-create-board="canCreateBoard"
        :can-manage-board="canManageBoard"
        :boards-failed="boardsFailed"
        :boards-tab="boardsTab"
        :active-boards-paging="activeBoardsPaging"
        :archive-boards-paging="archiveBoardsPaging"
        :board-archive="boardArchive"
        :unarchiving-board-id="unarchivingBoardId"
        :format-date="formatDate"
        @select-tab="selectBoardsTab"
        @create="createBoardModal.show"
        @unarchive="unarchiveBoard"
        @delete="askDeleteBoard"
      />

      <TeamMembersSection
        :team-id="props.id"
        :members="overview.members"
        :can-manage-team="canManageTeam"
        :current-user-id="currentUserId"
        :role-items="roleItems"
        :is-busy="isBusy"
        @role-change="onRoleChange"
        @remove="askRemove"
      />

      <TeamSettingsSection
        :can-manage-team="canManageTeam"
        :invite-url="inviteUrl"
        @rotate-click="rotateOpen = true"
        @rename-click="renameModal.show"
        @leave-click="leaveOpen = true"
        @delete-click="deleteOpen = true"
      />
    </template>

    <ConfirmModal
      v-model:open="rotateOpen"
      :title="t('team.rotateConfirmTitle')"
      :description="t('team.rotateConfirmText')"
      :confirm-label="t('team.rotateConfirm')"
      :loading="rotating"
      @confirm="rotate"
    />

    <ConfirmModal
      v-model:open="removeOpen"
      :title="t('team.removeConfirmTitle')"
      :description="t('team.removeConfirmText', { name: removeTarget?.name ?? '' })"
      :confirm-label="t('team.removeConfirm')"
      :loading="removeTarget ? isBusy(removeTarget.userId) : false"
      @confirm="confirmRemove"
    />

    <ConfirmModal
      v-model:open="leaveOpen"
      :title="t('team.leaveConfirmTitle')"
      :description="t('team.leaveConfirmText')"
      :confirm-label="t('team.leaveConfirm')"
      :loading="leaving"
      @confirm="confirmLeave"
    />

    <ConfirmModal
      v-model:open="deleteRoomOpen"
      :title="t('team.archiveDeleteConfirmTitle')"
      :description="t('team.archiveDeleteConfirmText', { name: deleteRoomTarget?.name ?? '' })"
      :confirm-label="t('team.archiveDeleteConfirm')"
      :loading="deletingRoom"
      @confirm="confirmDeleteRoom"
    />

    <ConfirmModal
      v-model:open="deleteBoardOpen"
      :title="t('team.archiveDeleteBoardConfirmTitle')"
      :description="
        t('team.archiveDeleteBoardConfirmText', { name: deleteBoardTarget?.title ?? '' })
      "
      :confirm-label="t('team.archiveDeleteBoardConfirm')"
      :loading="deletingBoard"
      @confirm="confirmDeleteBoard"
    />

    <EntityTextModal
      v-model:open="createRoomModal.open"
      :title="t('room.createTitle')"
      :label="t('common.nameLabel')"
      :placeholder="t('room.createNamePlaceholder')"
      :max-length="ROOM_NAME_MAX_LENGTH"
      :required-message="t('common.nameRequired')"
      :too-long-message="t('common.nameTooLong', { max: ROOM_NAME_MAX_LENGTH })"
      :cancel-label="t('common.cancel')"
      :submit-label="creatingRoom ? t('room.creating') : t('room.create')"
      :pending="creatingRoom"
      @submit="onCreateRoom"
    />

    <EntityTextModal
      v-model:open="createBoardModal.open"
      :title="t('board.createTitle')"
      :label="t('common.nameLabel')"
      :placeholder="t('board.createNamePlaceholder')"
      :max-length="BOARD_TITLE_MAX_LENGTH"
      :required-message="t('common.nameRequired')"
      :too-long-message="t('common.nameTooLong', { max: BOARD_TITLE_MAX_LENGTH })"
      :cancel-label="t('common.cancel')"
      :submit-label="creatingBoard ? t('board.creating') : t('board.create')"
      :pending="creatingBoard"
      @submit="onCreateBoard"
    />

    <EntityTextModal
      v-model:open="renameModal.open"
      :title="t('team.renameTitle')"
      :label="t('common.nameLabel')"
      :placeholder="t('teams.namePlaceholder')"
      :initial-value="overview?.team.name ?? ''"
      :max-length="TEAM_NAME_MAX_LENGTH"
      :required-message="t('common.nameRequired')"
      :too-long-message="t('common.nameTooLong', { max: TEAM_NAME_MAX_LENGTH })"
      :cancel-label="t('common.cancel')"
      :submit-label="t('team.rename')"
      :pending="renaming"
      @submit="onRename"
    />

    <ConfirmModal
      v-model:open="deleteOpen"
      :title="t('team.deleteConfirmTitle')"
      :description="t('team.deleteConfirmText')"
      :confirm-label="t('team.deleteConfirm')"
      :loading="deleting"
      @confirm="confirmDelete"
    />
  </section>
</template>
