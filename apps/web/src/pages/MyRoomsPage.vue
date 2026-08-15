<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { ROOM_NAME_MAX_LENGTH, trimText, type Room, type RoomStats } from '@poker/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import ConfirmModal from '../components/ConfirmModal.vue';
import { usePagedList } from '../composables/use-paged-list';
import { useAsyncAction } from '../composables/use-async-action';
import {
  createRoom as createRoomRequest,
  deleteRoom,
  getMyRoomStats,
  listMyRooms,
} from '../features/rooms/api/rooms-api';
import { MODAL_BUTTON_UI, MODAL_INPUT_UI, MODAL_UI } from '../lib/modal-ui';

const { t, locale } = useI18n();
const router = useRouter();
const toast = useToast();

const loading = ref(true);
const loadFailed = ref(false);
const list = ref<Room[]>([]);
const roomStats = ref<RoomStats | null>(null);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value);
}

// ISO-даты сравниваются лексикографически, поэтому свежие оказываются сверху
function byStatus(status: Room['status']): Room[] {
  return list.value
    .filter((room) => room.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

const activeRooms = computed(() => byStatus('active'));
const closedRooms = computed(() => byStatus('closed'));
const activePaging = usePagedList(activeRooms);
const closedPaging = usePagedList(closedRooms);

const roomSections = computed(() => [
  {
    key: 'active',
    title: t('myRooms.active'),
    badge: t('myRooms.roomActive'),
    color: 'primary' as const,
    paging: activePaging,
  },
  {
    key: 'closed',
    title: t('myRooms.closed'),
    badge: t('myRooms.roomClosed'),
    color: 'neutral' as const,
    paging: closedPaging,
  },
]);

onMounted(load);

async function load(): Promise<void> {
  loading.value = true;
  loadFailed.value = false;
  try {
    list.value = await listMyRooms(false);
    activePaging.reset();
    closedPaging.reset();
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
}

// --- Создание комнаты ---
const createOpen = ref(false);
const createState = reactive({ name: '' });

watch(createOpen, (isOpen) => {
  if (!isOpen) createState.name = '';
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

const { pending: creating, execute: createRoom } = useAsyncAction({
  run: (name: string) => createRoomRequest(name),
  success: async (room) => {
    createOpen.value = false;
    await router.push({ name: 'room', params: { id: room.id } });
  },
  error: () => {
    toast.add({ title: t('room.createError'), color: 'error' });
  },
});

async function onCreateRoom(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  await createRoom(trimText(event.data.name));
}

// --- Архив: грузится отдельно и по требованию, чтобы не тянуть его при каждом заходе ---
const archiveOpen = ref(false);
const archiveLoading = ref(false);
const archiveFailed = ref(false);
const archived = ref<Room[]>([]);
const archivedComputed = computed(() => archived.value);
const archivePaging = usePagedList(archivedComputed);
let archiveLoaded = false;

async function toggleArchive(): Promise<void> {
  archiveOpen.value = !archiveOpen.value;
  if (archiveOpen.value && !archiveLoaded) {
    archiveLoading.value = true;
    archiveFailed.value = false;
    try {
      archived.value = await listMyRooms(true);
      archivePaging.reset();
      archiveLoaded = true;
    } catch {
      archiveFailed.value = true;
    } finally {
      archiveLoading.value = false;
    }
  }
}

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
      <h1 class="font-heading text-3xl font-extrabold">{{ t('myRooms.title') }}</h1>
      <UButton
        icon="i-lucide-plus"
        class="h-[43px] px-[22px] text-[15px] font-bold"
        @click="createOpen = true"
      >
        {{ t('room.create') }}
      </UButton>
    </div>

    <UAlert
      v-if="loadFailed"
      color="error"
      variant="subtle"
      :description="t('myRooms.loadError')"
    />

    <div v-else-if="loading" class="space-y-5">
      <div class="grid gap-4 sm:grid-cols-3">
        <div v-for="i in 3" :key="i" class="surface-card px-6 py-[22px]">
          <USkeleton class="mb-3 h-3 w-1/2 bg-[var(--brand-border)]" />
          <USkeleton class="h-7 w-1/3 bg-[var(--brand-border)]" />
        </div>
      </div>
      <div class="surface-card overflow-hidden">
        <div
          v-for="i in 3"
          :key="i"
          class="border-default flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[22px] first:border-t-0 sm:px-[30px]"
        >
          <USkeleton class="h-5 w-1/3 bg-[var(--brand-border)]" />
          <USkeleton class="h-5 w-20 rounded-full bg-[var(--brand-border)]" />
        </div>
      </div>
    </div>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-3">
        <div v-for="stat in stats" :key="stat.label" class="surface-card px-6 py-[22px]">
          <div class="text-muted mb-2 text-[13px] font-bold tracking-[0.03em] uppercase">
            {{ stat.label }}
          </div>
          <div class="font-heading text-[28px] font-extrabold">
            {{ stat.value }}
          </div>
        </div>
      </div>

      <p v-if="list.length === 0" class="surface-card text-muted p-4 text-sm sm:p-[30px]">
        {{ t('myRooms.empty') }}
      </p>
      <div v-else class="surface-card overflow-hidden">
        <div v-for="section in roomSections" v-show="section.paging.total.value" :key="section.key">
          <h3
            class="text-muted px-4 py-5 sm:px-[30px] text-[13px] font-bold tracking-[0.03em] uppercase"
          >
            {{ section.title }}
          </h3>
          <RouterLink
            v-for="room in section.paging.items.value"
            :key="room.id"
            :to="{ name: 'room', params: { id: room.id } }"
            class="border-default hover:bg-elevated/50 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[22px] sm:px-[30px]"
          >
            <span class="min-w-28 flex-1 truncate text-[17px] font-bold">{{ room.name }}</span>
            <div class="flex shrink-0 items-center gap-3.5">
              <span v-if="room.teamId" class="badge-pill badge-pill-neutral">{{
                t('myRooms.teamBadge')
              }}</span>
              <span class="text-muted text-sm">{{ formatDate(room.createdAt) }}</span>
              <span
                class="badge-pill"
                :class="section.color === 'primary' ? 'badge-pill-primary' : 'badge-pill-neutral'"
                >{{ section.badge }}</span
              >
            </div>
          </RouterLink>
          <div
            v-if="section.paging.total.value > section.paging.pageSize"
            class="border-default flex justify-center border-t px-4 py-4 sm:px-[30px]"
          >
            <UPagination
              v-model:page="section.paging.page.value"
              :total="section.paging.total.value"
              :items-per-page="section.paging.pageSize"
            />
          </div>
        </div>
      </div>

      <div class="surface-card overflow-hidden">
        <div class="flex items-center justify-between gap-3 px-4 py-5 sm:px-[30px]">
          <h2 class="text-[17px] font-bold">{{ t('myRooms.archiveTitle') }}</h2>
          <button
            type="button"
            class="text-primary cursor-pointer text-sm font-bold"
            @click="toggleArchive"
          >
            {{ archiveOpen ? t('myRooms.archiveHide') : t('myRooms.archiveShow') }}
          </button>
        </div>

        <template v-if="archiveOpen">
          <UAlert
            v-if="archiveFailed"
            color="error"
            variant="subtle"
            class="mx-4 mb-5 sm:mx-[30px]"
            :description="t('myRooms.archiveError')"
          />
          <div v-else-if="archiveLoading" class="text-muted flex justify-center pb-5">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          </div>
          <p
            v-else-if="archivePaging.total.value === 0"
            class="text-muted px-4 pb-5 text-sm sm:px-[30px]"
          >
            {{ t('myRooms.archiveEmpty') }}
          </p>
          <template v-else>
            <div
              v-for="room in archivePaging.items.value"
              :key="room.id"
              class="border-default flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[18px] sm:px-[30px]"
            >
              <RouterLink
                :to="{ name: 'room', params: { id: room.id } }"
                class="min-w-28 flex-1 truncate text-[15.5px] font-bold"
              >
                {{ room.name }}
              </RouterLink>
              <div class="flex shrink-0 items-center gap-3">
                <span v-if="room.teamId" class="badge-pill badge-pill-neutral">{{
                  t('myRooms.teamBadge')
                }}</span>
                <span class="text-muted text-[13.5px]">{{ formatDate(room.createdAt) }}</span>
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="sm"
                  @click="askDelete(room)"
                >
                  {{ t('myRooms.deleteRoom') }}
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

    <UModal v-model:open="createOpen" :title="t('room.createTitle')" :ui="MODAL_UI">
      <template #body>
        <UForm
          :state="createState"
          :validate="validateRoomName"
          class="space-y-4"
          @submit="onCreateRoom"
        >
          <UFormField :label="t('teams.nameLabel')" name="name">
            <UInput
              v-model="createState.name"
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
              @click="createOpen = false"
            >
              {{ t('teams.cancel') }}
            </UButton>
            <UButton type="submit" :ui="MODAL_BUTTON_UI" :loading="creating">
              {{ creating ? t('room.creating') : t('room.create') }}
            </UButton>
          </div>
        </UForm>
      </template>
    </UModal>

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
