<script setup lang="ts">
import type { Room } from '@estimate/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ArchiveTab } from '../../composables/use-archive-tab';
import type { PagedList } from '../../composables/use-paged-list';

defineProps<{
  canManageTeam: boolean;
  roomsFailed: boolean;
  roomsTab: 'active' | 'archive';
  activeRoomsPaging: PagedList<Room>;
  archiveTabPaging: PagedList<Room>;
  roomArchive: ArchiveTab;
  formatDate: (iso: string) => string;
}>();

const emit = defineEmits<{
  selectTab: [tab: 'active' | 'archive'];
  create: [];
  delete: [room: Room];
}>();

const { t } = useI18n();

const roomTabs = computed(() => [
  { key: 'active' as const, label: t('team.roomsActive') },
  { key: 'archive' as const, label: t('team.tabArchive') },
]);
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
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
          @click="emit('selectTab', tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>
      <UButton v-if="canManageTeam" icon="i-lucide-plus" @click="emit('create')">
        {{ t('room.create') }}
      </UButton>
    </div>

    <UAlert
      v-if="roomsFailed"
      color="error"
      variant="subtle"
      class="mb-5"
      :description="t('team.roomsError')"
    />
    <template v-else-if="roomsTab === 'active'">
      <p v-if="activeRoomsPaging.total.value === 0" class="text-muted pb-5 text-sm">
        {{ t('team.roomsEmpty') }}
      </p>
      <RouterLink
        v-for="room in activeRoomsPaging.items.value"
        :key="room.id"
        :to="{ name: 'room', params: { id: room.id } }"
        class="border-default hover:bg-elevated/50 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-5 sm:px-8"
      >
        <span class="min-w-28 flex-1 truncate text-base font-bold">{{ room.name }}</span>
        <div class="flex shrink-0 items-center gap-3.5">
          <span class="text-muted text-sm">{{ formatDate(room.createdAt) }}</span>
          <span class="badge-pill badge-pill-primary">{{ t('team.roomActive') }}</span>
        </div>
      </RouterLink>
      <div
        v-if="activeRoomsPaging.total.value > activeRoomsPaging.pageSize"
        class="border-default flex justify-center border-t px-4 py-4 sm:px-8"
      >
        <!-- eslint-disable vue/no-mutating-props -- `page` — общая Ref-ячейка
             composable'а usePagedList, а не сам объект prop-а; перетаскивание
             страницы в родителе работает так же -->
        <UPagination
          v-model:page="activeRoomsPaging.page.value"
          :total="activeRoomsPaging.total.value"
          :items-per-page="activeRoomsPaging.pageSize"
        />
        <!-- eslint-enable vue/no-mutating-props -->
      </div>
    </template>
    <template v-else>
      <!-- Ошибка тянет только заархивированную часть (доступна лишь администратору) —
           уже загруженные завершённые комнаты всё равно показываем ниже, не прячем их
           за баннером. -->
      <UAlert
        v-if="roomArchive.failed"
        color="error"
        variant="subtle"
        class="mb-5"
        :description="t('team.archiveError')"
      />
      <div v-if="roomArchive.loading" class="text-muted flex justify-center pb-5">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
      </div>
      <template v-else>
        <p v-if="archiveTabPaging.total.value === 0" class="text-muted pb-5 text-sm">
          {{ t('team.archiveEmpty') }}
        </p>
        <div
          v-for="room in archiveTabPaging.items.value"
          :key="room.id"
          class="border-default flex flex-wrap items-center justify-between gap-3 border-t px-4 py-5 sm:px-8"
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
              @click="emit('delete', room)"
            >
              {{ t('team.archiveDeleteRoom') }}
            </UButton>
          </div>
        </div>
        <div
          v-if="archiveTabPaging.total.value > archiveTabPaging.pageSize"
          class="border-default flex justify-center border-t px-4 py-4 sm:px-8"
        >
          <!-- eslint-disable vue/no-mutating-props -- см. пояснение выше -->
          <UPagination
            v-model:page="archiveTabPaging.page.value"
            :total="archiveTabPaging.total.value"
            :items-per-page="archiveTabPaging.pageSize"
          />
          <!-- eslint-enable vue/no-mutating-props -->
        </div>
      </template>
    </template>
  </div>
</template>
