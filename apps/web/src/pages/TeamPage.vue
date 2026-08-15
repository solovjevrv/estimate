<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import {
  BOARD_TITLE_MAX_LENGTH,
  hasTeamRole,
  ROOM_NAME_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  TEAM_ROLES,
  trimText,
  type BoardSummary,
  type Room,
  type TeamMember,
  type TeamRole,
} from '@poker/shared';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import ConfirmModal from '../components/ConfirmModal.vue';
import { usePagedList } from '../composables/use-paged-list';
import { useAsyncAction } from '../composables/use-async-action';
import { ApiError } from '../lib/api';
import { MODAL_BUTTON_UI, MODAL_INPUT_UI, MODAL_UI } from '../lib/modal-ui';
import { roleBadgeColor, teamAvatarColor } from '../lib/team-roles';
import { useBoardsStore } from '../stores/boards';
import { useRoomsStore } from '../stores/rooms';
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
const rooms = useRoomsStore();
const teamBoards = useTeamBoardsStore();
const boards = useBoardsStore();
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

const roomTabs = computed(() => [
  { key: 'active' as const, label: t('team.roomsActive') },
  { key: 'archive' as const, label: t('team.tabArchive') },
]);

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

const boardTabs = computed(() => [
  { key: 'active' as const, label: t('team.boardsActive') },
  { key: 'archive' as const, label: t('team.tabArchive') },
]);
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
const archiveLoading = ref(false);
const archiveFailed = ref(false);
let archiveLoaded = false;

const boardsTab = ref<'active' | 'archive'>('active');
const archiveBoardsLoading = ref(false);
const archiveBoardsFailed = ref(false);
let archiveBoardsLoaded = false;

// immediate — грузим при заходе; watch — на случай перехода между командами,
// когда vue-router переиспользует компонент и onMounted повторно не срабатывает
watch(() => props.id, load, { immediate: true });

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  loadFailed.value = false;
  roomsFailed.value = false;
  roomsTab.value = 'active';
  archiveLoaded = false;
  archiveFailed.value = false;
  teamRooms.reset();
  activeRoomsPaging.reset();
  archiveTabPaging.reset();
  boardsFailed.value = false;
  boardsTab.value = 'active';
  archiveBoardsLoaded = false;
  archiveBoardsFailed.value = false;
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
  if (tab === 'archive' && canManageTeam.value && !archiveLoaded) {
    archiveLoading.value = true;
    archiveFailed.value = false;
    try {
      await teamRooms.loadArchived(props.id);
      archiveTabPaging.reset();
      archiveLoaded = true;
    } catch {
      archiveFailed.value = true;
    } finally {
      archiveLoading.value = false;
    }
  }
}

// Архив досок, в отличие от архива комнат, доступен на чтение любому участнику
// команды — сервер (`listForTeam`) не сужает его до администратора (12.1)
async function selectBoardsTab(tab: 'active' | 'archive'): Promise<void> {
  boardsTab.value = tab;
  if (tab === 'archive' && !archiveBoardsLoaded) {
    archiveBoardsLoading.value = true;
    archiveBoardsFailed.value = false;
    try {
      await teamBoards.loadArchived(props.id);
      archiveBoardsPaging.reset();
      archiveBoardsLoaded = true;
    } catch {
      archiveBoardsFailed.value = true;
    } finally {
      archiveBoardsLoading.value = false;
    }
  }
}

const deleteRoomTarget = ref<Room | null>(null);
const deleteRoomOpen = ref(false);

function askDeleteRoom(room: Room): void {
  deleteRoomTarget.value = room;
  deleteRoomOpen.value = true;
}

const { pending: deletingRoom, execute: deleteRoom } = useAsyncAction({
  run: (target: Room) => rooms.remove(target.id),
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
const createRoomOpen = ref(false);
const createRoomState = reactive({ name: '' });

watch(createRoomOpen, (isOpen) => {
  if (!isOpen) createRoomState.name = '';
});

function validateRoomName(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = trimText(s.name);
  if (!name) {
    errors.push({ name: 'name', message: t('teams.nameRequired') });
  } else if (name.length > ROOM_NAME_MAX_LENGTH) {
    errors.push({ name: 'name', message: t('teams.nameTooLong', { max: ROOM_NAME_MAX_LENGTH }) });
  }
  return errors;
}

const { pending: creatingRoom, execute: createTeamRoom } = useAsyncAction({
  run: (name: string) => rooms.create(name, props.id),
  success: async (room) => {
    createRoomOpen.value = false;
    await router.push({ name: 'room', params: { id: room.id } });
  },
  error: () => {
    toast.add({ title: t('room.createError'), color: 'error' });
  },
});

async function onCreateRoom(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  await createTeamRoom(trimText(event.data.name));
}

// --- Создание доски от лица команды ---
const createBoardOpen = ref(false);
const createBoardState = reactive({ title: '' });

watch(createBoardOpen, (isOpen) => {
  if (!isOpen) createBoardState.title = '';
});

function validateBoardTitle(s: { title: string }): FormError[] {
  const errors: FormError[] = [];
  const title = trimText(s.title);
  if (!title) {
    errors.push({ name: 'title', message: t('teams.nameRequired') });
  } else if (title.length > BOARD_TITLE_MAX_LENGTH) {
    errors.push({
      name: 'title',
      message: t('teams.nameTooLong', { max: BOARD_TITLE_MAX_LENGTH }),
    });
  }
  return errors;
}

const { pending: creatingBoard, execute: createTeamBoard } = useAsyncAction({
  run: (title: string) => boards.create(title, props.id),
  success: async (board) => {
    createBoardOpen.value = false;
    await router.push({ name: 'board', params: { id: board.id } });
  },
  error: () => {
    toast.add({ title: t('board.createError'), color: 'error' });
  },
});

async function onCreateBoard(event: FormSubmitEvent<{ title: string }>): Promise<void> {
  await createTeamBoard(trimText(event.data.title));
}

const unarchivingBoardId = ref<string | null>(null);

async function unarchiveBoard(board: BoardSummary): Promise<void> {
  unarchivingBoardId.value = board.id;
  try {
    await boards.unarchive(board.id);
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
  run: (target: BoardSummary) => boards.remove(target.id),
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

async function copyInvite(): Promise<void> {
  if (!inviteUrl.value) return;
  try {
    await navigator.clipboard.writeText(inviteUrl.value);
    toast.add({ title: t('team.copied'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('team.copyFailed'), color: 'error' });
  }
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
const renameOpen = ref(false);
const renameState = reactive({ name: '' });

// Открыли — подставляем текущее имя; закрыли — очищаем, чтобы не мигало старое
watch(renameOpen, (open) => {
  renameState.name = open ? (overview.value?.team.name ?? '') : '';
});

function validateName(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = trimText(s.name);
  if (!name) {
    errors.push({ name: 'name', message: t('teams.nameRequired') });
  } else if (name.length > TEAM_NAME_MAX_LENGTH) {
    errors.push({ name: 'name', message: t('teams.nameTooLong', { max: TEAM_NAME_MAX_LENGTH }) });
  }
  return errors;
}

const { pending: renaming, execute: renameTeam } = useAsyncAction({
  run: (name: string) => teams.rename(props.id, name),
  success: () => {
    toast.add({ title: t('team.renamed'), color: 'success', icon: 'i-lucide-check' });
    renameOpen.value = false;
  },
  error: () => {
    toast.add({ title: t('team.renameError'), color: 'error' });
  },
});

async function onRename(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  await renameTeam(trimText(event.data.name));
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

      <div class="surface-card overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-[30px]">
          <h2 class="text-[17px] font-bold">{{ t('team.roomsTitle') }}</h2>
          <UButton
            v-if="canManageTeam"
            icon="i-lucide-plus"
            class="rounded-[11px] px-[18px] py-[11px] text-sm font-bold"
            @click="createRoomOpen = true"
          >
            {{ t('room.create') }}
          </UButton>
        </div>

        <div class="flex items-center gap-2 px-4 pb-4 sm:px-[30px]">
          <button
            v-for="tab in roomTabs"
            :key="tab.key"
            type="button"
            class="rounded-full px-4 py-1.5 text-[13px] font-bold transition-colors"
            :class="
              roomsTab === tab.key
                ? 'bg-[var(--brand-primary-soft-bg)] text-[var(--brand-primary-text)]'
                : 'text-muted hover:text-default cursor-pointer'
            "
            @click="selectRoomsTab(tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>

        <UAlert
          v-if="roomsFailed"
          color="error"
          variant="subtle"
          class="mx-4 mb-5 sm:mx-[30px]"
          :description="t('team.roomsError')"
        />
        <template v-else-if="roomsTab === 'active'">
          <p
            v-if="activeRoomsPaging.total.value === 0"
            class="text-muted px-4 pb-5 sm:px-[30px] text-sm"
          >
            {{ t('team.roomsEmpty') }}
          </p>
          <RouterLink
            v-for="room in activeRoomsPaging.items.value"
            :key="room.id"
            :to="{ name: 'room', params: { id: room.id } }"
            class="border-default hover:bg-elevated/50 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[18px] sm:px-[30px]"
          >
            <span class="min-w-28 flex-1 truncate text-base font-bold">{{ room.name }}</span>
            <div class="flex shrink-0 items-center gap-3.5">
              <span class="text-muted text-sm">{{ formatDate(room.createdAt) }}</span>
              <span class="badge-pill badge-pill-primary">{{ t('team.roomActive') }}</span>
            </div>
          </RouterLink>
          <div
            v-if="activeRoomsPaging.total.value > activeRoomsPaging.pageSize"
            class="border-default flex justify-center border-t px-4 py-4 sm:px-[30px]"
          >
            <UPagination
              v-model:page="activeRoomsPaging.page.value"
              :total="activeRoomsPaging.total.value"
              :items-per-page="activeRoomsPaging.pageSize"
            />
          </div>
        </template>
        <template v-else>
          <!-- Ошибка тянет только заархивированную часть (доступна лишь администратору) —
               уже загруженные завершённые комнаты всё равно показываем ниже, не прячем их
               за баннером. -->
          <UAlert
            v-if="archiveFailed"
            color="error"
            variant="subtle"
            class="mx-4 mb-5 sm:mx-[30px]"
            :description="t('team.archiveError')"
          />
          <div v-if="archiveLoading" class="text-muted flex justify-center pb-5">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          </div>
          <template v-else>
            <p
              v-if="archiveTabPaging.total.value === 0"
              class="text-muted px-4 pb-5 sm:px-[30px] text-sm"
            >
              {{ t('team.archiveEmpty') }}
            </p>
            <div
              v-for="room in archiveTabPaging.items.value"
              :key="room.id"
              class="border-default flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[18px] sm:px-[30px]"
            >
              <RouterLink
                :to="{ name: 'room', params: { id: room.id } }"
                class="min-w-28 flex-1 truncate text-base font-bold"
              >
                {{ room.name }}
              </RouterLink>
              <div class="flex shrink-0 items-center gap-3.5">
                <span class="text-muted text-sm">{{ formatDate(room.createdAt) }}</span>
                <span class="badge-pill badge-pill-neutral">{{ t('team.roomClosed') }}</span>
                <UButton
                  v-if="room.archivedAt && canManageTeam"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="sm"
                  @click="askDeleteRoom(room)"
                >
                  {{ t('team.archiveDeleteRoom') }}
                </UButton>
              </div>
            </div>
            <div
              v-if="archiveTabPaging.total.value > archiveTabPaging.pageSize"
              class="border-default flex justify-center border-t px-4 py-4 sm:px-[30px]"
            >
              <UPagination
                v-model:page="archiveTabPaging.page.value"
                :total="archiveTabPaging.total.value"
                :items-per-page="archiveTabPaging.pageSize"
              />
            </div>
          </template>
        </template>
      </div>

      <div class="surface-card overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-[30px]">
          <h2 class="text-[17px] font-bold">{{ t('team.boardsTitle') }}</h2>
          <UButton
            v-if="canCreateBoard"
            icon="i-lucide-plus"
            class="rounded-[11px] px-[18px] py-[11px] text-sm font-bold"
            @click="createBoardOpen = true"
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
            @click="selectBoardsTab(tab.key)"
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
            <UPagination
              v-model:page="activeBoardsPaging.page.value"
              :total="activeBoardsPaging.total.value"
              :items-per-page="activeBoardsPaging.pageSize"
            />
          </div>
        </template>
        <template v-else>
          <UAlert
            v-if="archiveBoardsFailed"
            color="error"
            variant="subtle"
            class="mx-4 mb-5 sm:mx-[30px]"
            :description="t('team.boardsError')"
          />
          <div v-if="archiveBoardsLoading" class="text-muted flex justify-center pb-5">
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
                    @click="unarchiveBoard(board)"
                  >
                    {{ t('team.archiveUnarchiveBoard') }}
                  </UButton>
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="sm"
                    @click="askDeleteBoard(board)"
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
              <UPagination
                v-model:page="archiveBoardsPaging.page.value"
                :total="archiveBoardsPaging.total.value"
                :items-per-page="archiveBoardsPaging.pageSize"
              />
            </div>
          </template>
        </template>
      </div>

      <div class="surface-card px-4 py-5 sm:px-[30px] sm:py-[26px]">
        <h2 class="mb-[18px] text-[17px] font-bold">{{ t('team.membersTitle') }}</h2>
        <div
          v-for="member in overview.members"
          :key="member.userId"
          class="border-default flex flex-wrap items-center justify-between gap-3 border-t py-3.5 first:border-t-0 first:pt-0 last:pb-0"
        >
          <RouterLink
            :to="{ name: 'team-member', params: { id: props.id, userId: member.userId } }"
            class="hover:text-primary flex min-w-36 items-center gap-3.5"
          >
            <UAvatar
              :src="member.avatarUrl ?? undefined"
              :alt="member.name"
              size="md"
              class="size-[38px] shrink-0"
              :class="teamAvatarColor(member.userId)"
              :ui="{ fallback: 'font-heading text-[12px] font-bold text-white' }"
            />
            <span class="min-w-0 truncate text-[15.5px] font-bold">{{ member.name }}</span>
          </RouterLink>

          <div class="ml-[52px] flex shrink-0 items-center gap-3 sm:ml-0">
            <!-- Администратор меняет роли всем, кроме себя; себе показываем бейдж -->
            <USelect
              v-if="canManageTeam && member.userId !== currentUserId"
              :model-value="member.role"
              :items="roleItems"
              value-key="value"
              :aria-label="t('team.roleLabel')"
              :disabled="isBusy(member.userId)"
              class="w-40"
              :ui="{
                base: 'rounded-[9px] border border-[var(--brand-border)] bg-[var(--brand-surface)] py-2 ps-3.5 pe-[34px] ring-0',
              }"
              @update:model-value="onRoleChange(member, $event as TeamRole)"
            />
            <span
              v-else
              class="badge-pill"
              :class="
                roleBadgeColor(member.role) === 'primary'
                  ? 'badge-pill-primary'
                  : 'badge-pill-neutral'
              "
            >
              {{ t(`role.${member.role}`) }}
            </span>

            <UButton
              v-if="canManageTeam && member.userId !== currentUserId"
              icon="i-lucide-user-minus"
              color="error"
              variant="ghost"
              size="sm"
              :aria-label="t('team.remove')"
              :disabled="isBusy(member.userId)"
              @click="askRemove(member)"
            />
          </div>
        </div>
      </div>

      <div v-if="inviteUrl" class="surface-card px-4 py-5 sm:px-[30px] sm:py-[26px]">
        <h2 class="mb-1.5 text-[17px] font-bold">{{ t('team.inviteTitle') }}</h2>
        <p class="text-muted mb-4 text-sm">{{ t('team.inviteHint') }}</p>
        <div class="mb-3.5 flex flex-wrap items-center gap-3">
          <UInput
            :model-value="inviteUrl"
            readonly
            class="grow"
            :ui="{
              base: 'font-mono rounded-[11px] border-[length:1.5px] border-[color:var(--brand-border)] bg-[var(--brand-surface)] px-4 py-3 ring-0',
            }"
          />
          <UButton
            icon="i-lucide-copy"
            class="rounded-[10px] px-[18px] py-3 text-sm font-bold"
            @click="copyInvite"
          >
            {{ t('team.copy') }}
          </UButton>
        </div>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="link"
          class="p-0 text-[13.5px] font-semibold"
          @click="rotateOpen = true"
        >
          {{ t('team.rotate') }}
        </UButton>
      </div>

      <div class="surface-card px-4 py-5 sm:px-[30px] sm:py-[26px]">
        <h2 class="mb-[18px] text-[17px] font-bold">{{ t('team.settingsTitle') }}</h2>
        <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <UButton
            v-if="canManageTeam"
            icon="i-lucide-pencil"
            color="neutral"
            variant="outline"
            class="w-full justify-center rounded-[10px] px-[18px] py-[11px] text-sm font-bold sm:w-auto"
            @click="renameOpen = true"
          >
            {{ t('team.rename') }}
          </UButton>
          <!-- Выйти может любой участник; единственному администратору бэкенд
               откажет (409) и предложит сначала назначить другого -->
          <UButton
            icon="i-lucide-log-out"
            color="neutral"
            variant="outline"
            class="w-full justify-center rounded-[10px] px-[18px] py-[11px] text-sm font-bold sm:w-auto"
            @click="leaveOpen = true"
          >
            {{ t('team.leave') }}
          </UButton>
          <UButton
            v-if="canManageTeam"
            icon="i-lucide-trash-2"
            color="error"
            variant="subtle"
            class="w-full justify-center rounded-[10px] px-[18px] py-[11px] text-sm font-bold sm:w-auto"
            @click="deleteOpen = true"
          >
            {{ t('team.deleteTeam') }}
          </UButton>
        </div>
      </div>
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

    <UModal v-model:open="createRoomOpen" :title="t('room.createTitle')" :ui="MODAL_UI">
      <template #body>
        <UForm
          :state="createRoomState"
          :validate="validateRoomName"
          class="space-y-4"
          @submit="onCreateRoom"
        >
          <UFormField :label="t('teams.nameLabel')" name="name">
            <UInput
              v-model="createRoomState.name"
              :placeholder="t('room.createNamePlaceholder')"
              :maxlength="ROOM_NAME_MAX_LENGTH"
              autofocus
              class="w-full"
              :ui="MODAL_INPUT_UI"
            />
          </UFormField>

          <div class="flex justify-end gap-2.5">
            <UButton
              color="neutral"
              variant="outline"
              :ui="MODAL_BUTTON_UI"
              @click="createRoomOpen = false"
            >
              {{ t('teams.cancel') }}
            </UButton>
            <UButton type="submit" :ui="MODAL_BUTTON_UI" :loading="creatingRoom">
              {{ creatingRoom ? t('room.creating') : t('room.create') }}
            </UButton>
          </div>
        </UForm>
      </template>
    </UModal>

    <UModal v-model:open="createBoardOpen" :title="t('board.createTitle')" :ui="MODAL_UI">
      <template #body>
        <UForm
          :state="createBoardState"
          :validate="validateBoardTitle"
          class="space-y-4"
          @submit="onCreateBoard"
        >
          <UFormField :label="t('teams.nameLabel')" name="title">
            <UInput
              v-model="createBoardState.title"
              :placeholder="t('board.createNamePlaceholder')"
              :maxlength="BOARD_TITLE_MAX_LENGTH"
              autofocus
              class="w-full"
              :ui="MODAL_INPUT_UI"
            />
          </UFormField>

          <div class="flex justify-end gap-2.5">
            <UButton
              color="neutral"
              variant="outline"
              :ui="MODAL_BUTTON_UI"
              @click="createBoardOpen = false"
            >
              {{ t('teams.cancel') }}
            </UButton>
            <UButton type="submit" :ui="MODAL_BUTTON_UI" :loading="creatingBoard">
              {{ creatingBoard ? t('board.creating') : t('board.create') }}
            </UButton>
          </div>
        </UForm>
      </template>
    </UModal>

    <UModal v-model:open="renameOpen" :title="t('team.renameTitle')" :ui="MODAL_UI">
      <template #body>
        <UForm :state="renameState" :validate="validateName" class="space-y-4" @submit="onRename">
          <UFormField :label="t('teams.nameLabel')" name="name">
            <UInput
              v-model="renameState.name"
              :placeholder="t('teams.namePlaceholder')"
              :maxlength="TEAM_NAME_MAX_LENGTH"
              autofocus
              class="w-full"
              :ui="MODAL_INPUT_UI"
            />
          </UFormField>

          <div class="flex justify-end gap-2.5">
            <UButton
              color="neutral"
              variant="outline"
              :ui="MODAL_BUTTON_UI"
              @click="renameOpen = false"
            >
              {{ t('teams.cancel') }}
            </UButton>
            <UButton type="submit" :ui="MODAL_BUTTON_UI" :loading="renaming">
              {{ t('team.rename') }}
            </UButton>
          </div>
        </UForm>
      </template>
    </UModal>

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
