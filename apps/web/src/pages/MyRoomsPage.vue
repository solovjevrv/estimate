<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables';
import { hasTeamRole, ROOM_NAME_MAX_LENGTH, type Room, type RoomStats } from '@estimate/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import ConfirmModal from '../components/ConfirmModal.vue';
import EntityTextModal from '../components/EntityTextModal.vue';
import RoomListSection from '../components/rooms/RoomListSection.vue';
import { useArchiveTab } from '../composables/use-archive-tab';
import { usePagedList } from '../composables/use-paged-list';
import { useAsyncAction } from '../composables/use-async-action';
import { useEntityModal } from '../composables/use-entity-modal';
import {
  archiveRoom as archiveRoomRequest,
  createRoom as createRoomRequest,
  deleteRoom,
  getMyRoomStats,
  listMyRooms,
  renameRoom as renameRoomRequest,
} from '../features/rooms/api/rooms-api';
import { useSessionStore } from '../stores/session';
import { useTeamsStore } from '../stores/teams';

const { t, locale } = useI18n();
const router = useRouter();
const toast = useToast();
const session = useSessionStore();
const teams = useTeamsStore();

const loading = ref(true);
const loadFailed = ref(false);
const list = ref<Room[]>([]);
const roomStats = ref<RoomStats | null>(null);

const currentUserId = computed(() => session.user?.id ?? null);
const teamRoleById = computed(() => new Map(teams.list.map((team) => [team.id, team.role])));
const teamNameById = computed(() => new Map(teams.list.map((team) => [team.id, team.name])));

/** 7.20: переименовать/заархивировать/удалить комнату может её создатель или админ
 *  команды, которой принадлежит комната — та же роль scrum_master, что и внутри
 *  самой комнаты (rooms.policy.ts) */
function canManageRoom(room: Room): boolean {
  if (room.creatorId === currentUserId.value) return true;
  if (!room.teamId) return false;
  const role = teamRoleById.value.get(room.teamId);
  return !!role && hasTeamRole(role, 'admin');
}

function teamTagFor(room: Room): string | null {
  return room.teamId ? (teamNameById.value.get(room.teamId) ?? null) : null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value);
}

function formatAvgDuration(sec: number): string {
  const total = Math.round(sec);
  return t('myRooms.statsAvgTimeValue', {
    minutes: Math.floor(total / 60),
    seconds: total % 60,
  });
}

// Статистика не критична для страницы — при её отсутствии/ошибке загрузки
// показываем прочерк, но не блокируем список комнат
const stats = computed(() => {
  const placeholder = t('myRooms.statsPlaceholder');
  const data = roomStats.value;
  return [
    { label: t('myRooms.statsRounds'), value: data ? String(data.roundsPlayed) : placeholder },
    { label: t('myRooms.statsEstimated'), value: data ? String(data.tasksEstimated) : placeholder },
    {
      label: t('myRooms.statsAvgTime'),
      value:
        data && data.avgRoundDurationSec !== null
          ? formatAvgDuration(data.avgRoundDurationSec)
          : placeholder,
    },
  ];
});

// --- Вкладки «Активные»/«Архив» (06_Rooms: та же пара пилюль, что на странице
// команды) — «Архив» объединяет завершённые (видны все статусы) и по-настоящему
// заархивированные (грузятся отдельно, по требованию) ---
const roomsTab = ref<'active' | 'archive'>('active');
// ISO-даты сравниваются лексикографически, поэтому свежие оказываются сверху
function byStatus(status: Room['status']): Room[] {
  return list.value
    .filter((room) => room.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
const activeRooms = computed(() => byStatus('active'));
const closedRooms = computed(() => byStatus('closed'));
const activeRoomsPaging = usePagedList(activeRooms);

const archived = ref<Room[]>([]);
const archiveTabRooms = computed(() =>
  [...closedRooms.value, ...archived.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);
const archiveTabPaging = usePagedList(archiveTabRooms);
const roomArchive = useArchiveTab(async () => {
  archived.value = await listMyRooms(true);
}, archiveTabPaging.reset);

async function selectRoomsTab(tab: 'active' | 'archive'): Promise<void> {
  roomsTab.value = tab;
  if (tab === 'archive') await roomArchive.activate();
}

onMounted(load);

async function load(): Promise<void> {
  loading.value = true;
  loadFailed.value = false;
  roomsTab.value = 'active';
  roomArchive.reset();
  activeRoomsPaging.reset();
  archiveTabPaging.reset();
  try {
    list.value = await listMyRooms(false);
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
  try {
    roomStats.value = await getMyRoomStats();
  } catch {
    roomStats.value = null;
  }
  try {
    await teams.loadList();
  } catch {
    // Пилюля команды и права на переименование/архивацию по команде — необязательная
    // деталь строки; при сбое остаётся доступной только собственная комната (creatorId)
  }
}

/** Обновляет и активный, и заархивированный список — переименованная/заархивированная
 * комната может быть на любой из двух вкладок; сбой тихой довозгрузки архива не должен
 * превращать успешное действие в error-тост. */
async function reloadRoomsAfterMutation(): Promise<void> {
  try {
    list.value = await listMyRooms(false);
  } catch {
    loadFailed.value = true;
  }
  try {
    archived.value = await listMyRooms(true);
  } catch {
    // Архив обновится при следующем открытии вкладки — не критично
  }
}

// --- Создание комнаты ---
const createRoomModal = useEntityModal();

const { pending: creating, execute: createRoom } = useAsyncAction({
  run: (name: string) => createRoomRequest(name),
  success: async (room) => {
    createRoomModal.close();
    await router.push({ name: 'room', params: { id: room.id } });
  },
  error: () => {
    toast.add({ title: t('room.createError'), color: 'error' });
  },
});

async function onCreateRoom(name: string): Promise<void> {
  await createRoom(name);
}

// --- Переименование ---
const renameRoomTarget = ref<Room | null>(null);
const renameRoomModal = useEntityModal();

function askRenameRoom(room: Room): void {
  renameRoomTarget.value = room;
  renameRoomModal.show();
}

const { pending: renamingRoom, execute: renameRoom } = useAsyncAction({
  run: (name: string) => {
    const target = renameRoomTarget.value;
    if (!target) return Promise.reject(new Error('no rename target'));
    return renameRoomRequest(target.id, name);
  },
  success: async () => {
    renameRoomModal.close();
    toast.add({ title: t('room.renamed'), color: 'success', icon: 'i-lucide-check' });
    await reloadRoomsAfterMutation();
  },
  error: () => {
    toast.add({ title: t('room.renameError'), color: 'error' });
  },
});

async function onRenameRoom(name: string): Promise<void> {
  if (!renameRoomTarget.value) return;
  await renameRoom(name);
}

// --- Архивация ---
const archiveRoomTarget = ref<Room | null>(null);
const archiveRoomOpen = ref(false);

function askArchiveRoom(room: Room): void {
  archiveRoomTarget.value = room;
  archiveRoomOpen.value = true;
}

const { pending: archivingRoom, execute: archiveRoom } = useAsyncAction({
  run: (target: Room) => archiveRoomRequest(target.id),
  success: async () => {
    archiveRoomOpen.value = false;
    toast.add({ title: t('room.archivedToast'), color: 'success', icon: 'i-lucide-check' });
    await reloadRoomsAfterMutation();
  },
  error: () => {
    toast.add({ title: t('room.archiveError'), color: 'error' });
  },
});

async function confirmArchiveRoom(): Promise<void> {
  const target = archiveRoomTarget.value;
  if (!target) return;
  await archiveRoom(target);
}

// --- Удаление (доступно только для уже заархивированной комнаты) ---
const deleteTarget = ref<Room | null>(null);
const deleteOpen = ref(false);

function askDelete(room: Room): void {
  deleteTarget.value = room;
  deleteOpen.value = true;
}

const { pending: deleting, execute: removeRoom } = useAsyncAction({
  run: (target: Room) => deleteRoom(target.id),
  success: (_, target) => {
    archived.value = archived.value.filter((room) => room.id !== target.id);
    toast.add({ title: t('myRooms.deleted'), color: 'success', icon: 'i-lucide-check' });
    deleteOpen.value = false;
  },
  error: () => {
    toast.add({ title: t('myRooms.deleteError'), color: 'error' });
  },
});

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;
  await removeRoom(target);
}
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="font-heading text-[32px] font-bold">{{ t('myRooms.title') }}</h1>
      <UButton icon="i-lucide-plus" size="lg" @click="createRoomModal.show">
        {{ t('room.create') }}
      </UButton>
    </div>

    <UAlert
      v-if="loadFailed"
      color="error"
      variant="subtle"
      :description="t('myRooms.loadError')"
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
      <div class="grid gap-4 sm:grid-cols-3">
        <div v-for="i in 3" :key="i" class="surface-card px-6 py-[22px]">
          <USkeleton class="mb-2 h-3 w-1/2 bg-border-medium" />
          <USkeleton class="h-8 w-1/3 bg-border-medium" />
        </div>
      </div>
      <div class="space-y-3">
        <div
          v-for="i in 3"
          :key="i"
          class="border-default flex items-center justify-between border-t px-4 py-5 first:border-t-0 sm:px-8"
        >
          <USkeleton class="h-5 w-1/3 bg-border-medium" />
          <USkeleton class="h-5 w-20 rounded-full bg-border-medium" />
        </div>
      </div>
    </div>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-3">
        <div v-for="stat in stats" :key="stat.label" class="surface-card px-6 py-[22px]">
          <div class="text-muted mb-2 text-[10px] leading-3 font-bold tracking-[0.03em] uppercase">
            {{ stat.label }}
          </div>
          <div class="font-heading text-2xl font-bold">
            {{ stat.value }}
          </div>
        </div>
      </div>

      <p class="text-muted text-sm">{{ t('myRooms.subtitle') }}</p>

      <RoomListSection
        :rooms-failed="false"
        :rooms-tab="roomsTab"
        :active-rooms-paging="activeRoomsPaging"
        :archive-tab-paging="archiveTabPaging"
        :room-archive="roomArchive"
        :format-date="formatDate"
        :can-manage-room="canManageRoom"
        :team-tag-for="teamTagFor"
        :error-message="t('myRooms.loadError')"
        :empty-active-message="t('myRooms.empty')"
        :empty-archive-message="t('myRooms.archiveEmpty')"
        :closed-badge-label="t('myRooms.roomClosed')"
        :delete-label="t('myRooms.deleteRoom')"
        @select-tab="selectRoomsTab"
        @rename="askRenameRoom"
        @archive="askArchiveRoom"
        @delete="askDelete"
        @retry="load"
      />
    </template>

    <EntityTextModal
      v-model:open="createRoomModal.open"
      :title="t('room.createTitle')"
      :label="t('common.nameLabel')"
      :placeholder="t('room.createNamePlaceholder')"
      :max-length="ROOM_NAME_MAX_LENGTH"
      :required-message="t('common.nameRequired')"
      :too-long-message="t('common.nameTooLong', { max: ROOM_NAME_MAX_LENGTH })"
      :cancel-label="t('common.cancel')"
      :submit-label="creating ? t('room.creating') : t('room.create')"
      :pending="creating"
      @submit="onCreateRoom"
    />

    <EntityTextModal
      v-model:open="renameRoomModal.open"
      :title="t('room.renameTitle')"
      :label="t('room.roomNameLabel')"
      :placeholder="t('room.createNamePlaceholder')"
      :initial-value="renameRoomTarget?.name ?? ''"
      :max-length="ROOM_NAME_MAX_LENGTH"
      :required-message="t('room.renameNameRequired')"
      :too-long-message="t('room.renameNameTooLong', { max: ROOM_NAME_MAX_LENGTH })"
      :cancel-label="t('common.cancel')"
      :submit-label="t('room.rename')"
      :pending="renamingRoom"
      @submit="onRenameRoom"
    />

    <ConfirmModal
      v-model:open="archiveRoomOpen"
      :title="t('room.archiveConfirmTitle')"
      :description="t('room.archiveConfirmText')"
      :confirm-label="t('room.archiveConfirm')"
      :loading="archivingRoom"
      @confirm="confirmArchiveRoom"
    />

    <ConfirmModal
      v-model:open="deleteOpen"
      :title="t('myRooms.deleteConfirmTitle')"
      :description="t('myRooms.deleteConfirmText', { name: deleteTarget?.name ?? '' })"
      :confirm-label="t('myRooms.deleteConfirm')"
      :loading="deleting"
      @confirm="confirmDelete"
    />
  </section>
</template>
