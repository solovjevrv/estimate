<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Room } from '@estimate/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ArchiveTab } from '../../composables/use-archive-tab';
import type { PagedList } from '../../composables/use-paged-list';

const props = defineProps<{
  roomsFailed: boolean;
  roomsTab: 'active' | 'archive';
  activeRoomsPaging: PagedList<Room>;
  archiveTabPaging: PagedList<Room>;
  roomArchive: ArchiveTab;
  formatDate: (iso: string) => string;
  /** Кебаб-меню строки видно только тому, кто может переименовать/заархивировать/удалить эту комнату (7.20: создатель комнаты или админ команды) */
  canManageRoom: (room: Room) => boolean;
  errorMessage: string;
  emptyActiveMessage: string;
  emptyArchiveMessage: string;
  closedBadgeLabel: string;
  deleteLabel: string;
  /** Плашка с именем команды у личных комнат (06_Rooms, «Комнаты — Список») — в контексте самой команды не нужна */
  teamTagFor?: (room: Room) => string | null;
}>();

const emit = defineEmits<{
  selectTab: [tab: 'active' | 'archive'];
  rename: [room: Room];
  archive: [room: Room];
  delete: [room: Room];
  retry: [];
}>();

const { t } = useI18n();

const roomTabs = computed(() => [
  { key: 'active' as const, label: t('team.roomsActive') },
  { key: 'archive' as const, label: t('team.tabArchive') },
]);

function activeMenuItems(room: Room): DropdownMenuItem[][] {
  return [
    [{ label: t('room.rename'), icon: 'i-lucide-pencil', onSelect: () => emit('rename', room) }],
    [
      {
        label: t('room.archive'),
        icon: 'i-lucide-archive',
        color: 'error' as const,
        onSelect: () => emit('archive', room),
      },
    ],
  ];
}

function archivedMenuItems(room: Room): DropdownMenuItem[][] {
  return [
    [{ label: t('room.rename'), icon: 'i-lucide-pencil', onSelect: () => emit('rename', room) }],
    [
      {
        label: props.deleteLabel,
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => emit('delete', room),
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
          v-for="tab in roomTabs"
          :key="tab.key"
          type="button"
          class="cursor-pointer rounded-full px-4 py-1.5 text-xs leading-[18px] font-bold transition-colors"
          :class="
            roomsTab === tab.key
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
      v-if="roomsFailed"
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
    <template v-else-if="roomsTab === 'active'">
      <p v-if="activeRoomsPaging.total.value === 0" class="text-muted pb-5 text-sm">
        {{ emptyActiveMessage }}
      </p>
      <div>
        <div
          v-for="room in activeRoomsPaging.items.value"
          :key="room.id"
          class="border-default hover:bg-border-medium flex flex-wrap items-center justify-between gap-3 border-t px-4 py-5 first:border-t-0 sm:px-8"
        >
          <RouterLink
            :to="{ name: 'room', params: { id: room.id } }"
            class="min-w-28 flex-1 truncate text-base font-bold"
          >
            {{ room.name }}
          </RouterLink>
          <div class="flex shrink-0 items-center gap-4">
            <span
              v-if="teamTagFor?.(room)"
              class="bg-border-medium text-muted rounded-full px-3 py-2 text-xs font-bold"
            >
              {{ teamTagFor(room) }}
            </span>
            <span class="text-muted text-sm">{{ formatDate(room.createdAt) }}</span>
            <UDropdownMenu v-if="canManageRoom(room)" :items="activeMenuItems(room)">
              <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="sm"
                :aria-label="t('room.roomMenu')"
              />
            </UDropdownMenu>
          </div>
        </div>
      </div>
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
          {{ emptyArchiveMessage }}
        </p>
        <div>
          <div
            v-for="room in archiveTabPaging.items.value"
            :key="room.id"
            class="border-default hover:bg-border-medium flex flex-wrap items-center justify-between gap-3 border-t px-4 py-5 first:border-t-0 sm:px-8"
          >
            <RouterLink
              :to="{ name: 'room', params: { id: room.id } }"
              class="min-w-28 flex-1 truncate text-base font-bold"
            >
              {{ room.name }}
            </RouterLink>
            <div class="flex shrink-0 items-center gap-4">
              <span
                v-if="teamTagFor?.(room)"
                class="bg-border-medium text-muted rounded-full px-3 py-2 text-xs font-bold"
              >
                {{ teamTagFor(room) }}
              </span>
              <span class="text-muted text-sm">{{ formatDate(room.createdAt) }}</span>
              <span class="badge-pill badge-pill-neutral">{{ closedBadgeLabel }}</span>
              <UDropdownMenu v-if="canManageRoom(room)" :items="archivedMenuItems(room)">
                <UButton
                  icon="i-lucide-ellipsis-vertical"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :aria-label="t('room.roomMenu')"
                />
              </UDropdownMenu>
            </div>
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
