<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables';
import type { Room } from '@poker/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useRoomsStore } from '../stores/rooms';

const { t, locale } = useI18n();
const toast = useToast();
const rooms = useRoomsStore();

const loading = ref(true);
const loadFailed = ref(false);
const list = ref<Room[]>([]);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value);
}

// ISO-даты сравниваются лексикографически, поэтому свежие оказываются сверху
function byStatus(status: Room['status']): Room[] {
  return list.value
    .filter((room) => room.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const roomSections = computed(() => [
  {
    key: 'active',
    title: t('myRooms.active'),
    color: 'success' as const,
    rooms: byStatus('active'),
  },
  {
    key: 'closed',
    title: t('myRooms.closed'),
    color: 'neutral' as const,
    rooms: byStatus('closed'),
  },
]);

onMounted(load);

async function load(): Promise<void> {
  loading.value = true;
  loadFailed.value = false;
  try {
    list.value = await rooms.listMine(false);
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

// --- Архив: грузится отдельно и по требованию, чтобы не тянуть его при каждом заходе ---
const archiveOpen = ref(false);
const archiveLoading = ref(false);
const archiveFailed = ref(false);
const archived = ref<Room[]>([]);
let archiveLoaded = false;

async function toggleArchive(): Promise<void> {
  archiveOpen.value = !archiveOpen.value;
  if (archiveOpen.value && !archiveLoaded) {
    archiveLoading.value = true;
    archiveFailed.value = false;
    try {
      archived.value = await rooms.listMine(true);
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
const deleting = ref(false);

function askDelete(room: Room): void {
  deleteTarget.value = room;
  deleteOpen.value = true;
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;
  deleting.value = true;
  try {
    await rooms.remove(target.id);
    archived.value = archived.value.filter((room) => room.id !== target.id);
    toast.add({ title: t('myRooms.deleted'), color: 'success', icon: 'i-lucide-check' });
    deleteOpen.value = false;
  } catch {
    toast.add({ title: t('myRooms.deleteError'), color: 'error' });
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <section class="space-y-6">
    <h1 class="text-2xl font-semibold">{{ t('myRooms.title') }}</h1>

    <UAlert
      v-if="loadFailed"
      color="error"
      variant="subtle"
      :description="t('myRooms.loadError')"
    />

    <div v-else-if="loading" class="text-muted flex justify-center py-8">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
    </div>

    <template v-else>
      <div class="surface-card p-6">
        <p v-if="list.length === 0" class="text-muted text-sm">{{ t('myRooms.empty') }}</p>
        <div v-else class="space-y-5">
          <div v-for="section in roomSections" v-show="section.rooms.length" :key="section.key">
            <h3 class="text-muted mb-2 text-xs font-medium tracking-wide uppercase">
              {{ section.title }}
            </h3>
            <ul class="divide-default divide-y">
              <li v-for="room in section.rooms" :key="room.id">
                <RouterLink
                  :to="{ name: 'room', params: { id: room.id } }"
                  class="hover:bg-elevated/50 -mx-2 flex items-center gap-3 rounded px-2 py-3"
                >
                  <span class="min-w-0 flex-1 truncate">{{ room.name }}</span>
                  <span class="text-muted text-xs">{{ formatDate(room.createdAt) }}</span>
                  <UBadge v-if="room.teamId" color="neutral" variant="subtle">
                    {{ t('myRooms.teamBadge') }}
                  </UBadge>
                  <UBadge :color="section.color" variant="subtle">{{ section.title }}</UBadge>
                </RouterLink>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div class="surface-card overflow-hidden">
        <div class="flex items-center justify-between gap-3 p-6" :class="{ 'pb-0': archiveOpen }">
          <h2 class="font-medium">{{ t('myRooms.archiveTitle') }}</h2>
          <UButton color="neutral" variant="ghost" size="sm" @click="toggleArchive">
            {{ archiveOpen ? t('myRooms.archiveHide') : t('myRooms.archiveShow') }}
          </UButton>
        </div>

        <template v-if="archiveOpen">
          <UAlert
            v-if="archiveFailed"
            color="error"
            variant="subtle"
            class="mx-6 mb-6"
            :description="t('myRooms.archiveError')"
          />
          <div v-else-if="archiveLoading" class="text-muted flex justify-center py-4">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          </div>
          <p v-else-if="archived.length === 0" class="text-muted px-6 pb-6 text-sm">
            {{ t('myRooms.archiveEmpty') }}
          </p>
          <ul v-else class="divide-default divide-y px-6 pb-2">
            <li
              v-for="room in archived"
              :key="room.id"
              class="flex items-center gap-3 py-3 first:pt-4 last:pb-4"
            >
              <RouterLink
                :to="{ name: 'room', params: { id: room.id } }"
                class="min-w-0 flex-1 truncate"
              >
                {{ room.name }}
              </RouterLink>
              <UBadge v-if="room.teamId" color="neutral" variant="subtle">
                {{ t('myRooms.teamBadge') }}
              </UBadge>
              <span class="text-muted text-xs">{{ formatDate(room.createdAt) }}</span>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                @click="askDelete(room)"
              >
                {{ t('myRooms.deleteRoom') }}
              </UButton>
            </li>
          </ul>
        </template>
      </div>
    </template>

    <UModal
      v-model:open="deleteOpen"
      :title="t('myRooms.deleteConfirmTitle')"
      :description="t('myRooms.deleteConfirmText', { name: deleteTarget?.name ?? '' })"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton color="error" :loading="deleting" @click="confirmDelete">
          {{ t('myRooms.deleteConfirm') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
