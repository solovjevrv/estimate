<script setup lang="ts">
import type { Room } from '@estimate/shared';
import { useI18n } from 'vue-i18n';

import type { ArchiveTab } from '../../composables/use-archive-tab';
import type { PagedList } from '../../composables/use-paged-list';
import RoomListSection from '../rooms/RoomListSection.vue';

const props = defineProps<{
  canManageTeam: boolean;
  currentUserId: string | null;
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
  rename: [room: Room];
  archive: [room: Room];
  delete: [room: Room];
  retry: [];
}>();

const { t } = useI18n();

/** 7.20: переименовать/заархивировать/удалить комнату может её создатель или админ
 *  команды — та же роль scrum_master, что и внутри самой комнаты (rooms.policy.ts) */
function canManageRoom(room: Room): boolean {
  return props.canManageTeam || room.creatorId === props.currentUserId;
}
</script>

<template>
  <RoomListSection
    :rooms-failed="roomsFailed"
    :rooms-tab="roomsTab"
    :active-rooms-paging="activeRoomsPaging"
    :archive-tab-paging="archiveTabPaging"
    :room-archive="roomArchive"
    :format-date="formatDate"
    :can-manage-room="canManageRoom"
    :error-message="t('team.roomsError')"
    :empty-active-message="t('team.roomsEmpty')"
    :empty-archive-message="t('team.archiveEmpty')"
    :closed-badge-label="t('team.roomClosed')"
    :delete-label="t('team.archiveDeleteRoom')"
    @select-tab="emit('selectTab', $event)"
    @rename="emit('rename', $event)"
    @archive="emit('archive', $event)"
    @delete="emit('delete', $event)"
    @retry="emit('retry')"
  >
    <template #actions>
      <UButton v-if="canManageTeam" icon="i-lucide-plus" @click="emit('create')">
        {{ t('room.create') }}
      </UButton>
    </template>
  </RoomListSection>
</template>
