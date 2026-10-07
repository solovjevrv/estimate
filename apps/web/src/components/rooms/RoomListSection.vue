<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Room } from '@estimate/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ArchiveTab } from '../../composables/use-archive-tab';
import type { PagedList } from '../../composables/use-paged-list';
import ListPagination from '../ListPagination.vue';
import MoveEntityModal from '../MoveEntityModal.vue';
import { useMoveAvailability } from '../../composables/use-move-availability';
import { roomMoveRequest, type MoveRequest } from '../../lib/move-entity';

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
  /** Плашка с именем команды или «Личная» (06_Rooms, «Комнаты — Список») — в контексте самой команды не нужна */
  teamTagFor?: (room: Room) => string | null;
  /** Отдельная страница «Комнаты»: пилюли и список через 32 (06_Rooms «Список»);
   *  на вкладке команды — 20 */
  pageLevel?: boolean;
}>();

const emit = defineEmits<{
  selectTab: [tab: 'active' | 'archive'];
  rename: [room: Room];
  /** Перенесена (10.24) — список нужно перечитать */
  moved: [];
  archive: [room: Room];
  delete: [room: Room];
  retry: [];
}>();

const { t } = useI18n();
/** Перенос из меню строки (10.24) — окно открыто, пока запрос не null */
const moveRequest = ref<MoveRequest | null>(null);
const { canMove } = useMoveAvailability();

const roomTabs = computed(() => [
  { key: 'active' as const, label: t('team.roomsActive') },
  { key: 'archive' as const, label: t('team.tabArchive') },
]);

function activeMenuItems(room: Room): DropdownMenuItem[][] {
  const first: DropdownMenuItem[] = [
    { label: t('room.rename'), icon: 'i-lucide-pencil', onSelect: () => emit('rename', room) },
  ];
  // «Перенести…» (10.24) — только если есть куда
  if (canMove('room', room.teamId, room.creatorId)) {
    first.push({
      label: t('move.menu'),
      icon: 'i-lucide-folder-input',
      onSelect: () => (moveRequest.value = roomMoveRequest(room)),
    });
  }
  return [
    first,
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
    <div
      class="flex flex-wrap items-center justify-between gap-3"
      :class="pageLevel ? 'mb-8' : 'mb-5'"
    >
      <div class="flex items-center gap-2">
        <button
          v-for="tab in roomTabs"
          :key="tab.key"
          type="button"
          class="cursor-pointer rounded-full px-4 py-1.5 text-xs leading-[18px] font-bold transition-colors"
          :class="
            roomsTab === tab.key
              ? 'bg-[var(--brand-primary-soft-bg)] text-[var(--brand-primary-text)] ring-1 ring-[var(--border-strong)] ring-inset'
              : 'text-text-secondary hover:text-text-primary'
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
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      orientation="horizontal"
      class="mb-5"
      :description="errorMessage"
      :actions="[
        {
          label: t('common.retry'),
          color: 'error',
          variant: 'outline',
          size: 'sm',
          onClick: () => emit('retry'),
        },
      ]"
    />
    <template v-else-if="roomsTab === 'active'">
      <p
        v-if="activeRoomsPaging.total.value === 0"
        class="text-text-secondary px-8 pb-8 text-xs font-medium"
      >
        {{ emptyActiveMessage }}
      </p>
      <div>
        <!-- Строка списка — 70px, одна на комнаты и состав (в макете 70/68, унифицировано);
             линия сверху (и у первой строки — под шапкой списка, как в макетах 06) — inset-тенью,
             а не border: граница съедала бы 1px из 70 и контент вставал на полупиксель -->
        <div
          v-for="room in activeRoomsPaging.items.value"
          :key="room.id"
          class="hover:bg-surface-hover flex min-h-[70px] flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-[inset_0_1px_0_var(--ui-border)] sm:px-[30px]"
        >
          <RouterLink
            :to="{ name: 'room', params: { id: room.id } }"
            class="text-text-primary min-w-28 flex-1 truncate text-base leading-6 font-bold tracking-[-0.01em]"
          >
            {{ room.name }}
          </RouterLink>
          <div class="flex shrink-0 items-center gap-3.5">
            <span v-if="teamTagFor?.(room)" class="badge-pill badge-pill-neutral">
              {{ teamTagFor(room) }}
            </span>
            <span class="text-text-secondary text-xs font-medium">{{
              formatDate(room.createdAt)
            }}</span>
            <UDropdownMenu v-if="canManageRoom(room)" :items="activeMenuItems(room)">
              <!-- Строка на hover уже surface-hover — у ⋮ внутри неё фон темнее (кит: ListRow/MemberRow) -->
              <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="sm"
                class="hover:bg-surface-tertiary"
                :aria-label="t('room.roomMenu')"
              />
            </UDropdownMenu>
          </div>
        </div>
      </div>
      <ListPagination :paging="activeRoomsPaging" />
    </template>
    <template v-else>
      <!-- Ошибка тянет только заархивированную часть (доступна лишь администратору) —
           уже загруженные завершённые комнаты всё равно показываем ниже, не прячем их
           за баннером. -->
      <UAlert
        v-if="roomArchive.failed"
        icon="i-lucide-circle-alert"
        color="error"
        variant="subtle"
        class="mb-5"
        :description="t('team.archiveError')"
      />
      <div v-if="roomArchive.loading" class="text-muted flex justify-center pb-5">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
      </div>
      <template v-else>
        <p
          v-if="archiveTabPaging.total.value === 0"
          class="text-text-secondary px-8 pb-8 text-xs font-medium"
        >
          {{ emptyArchiveMessage }}
        </p>
        <div>
          <!-- Строка списка — 70px, одна на комнаты и состав (в макете 70/68, унифицировано);
             линия сверху (и у первой строки — под шапкой списка, как в макетах 06) — inset-тенью,
             а не border: граница съедала бы 1px из 70 и контент вставал на полупиксель -->
          <div
            v-for="room in archiveTabPaging.items.value"
            :key="room.id"
            class="hover:bg-surface-hover flex min-h-[70px] flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-[inset_0_1px_0_var(--ui-border)] sm:px-[30px]"
          >
            <RouterLink
              :to="{ name: 'room', params: { id: room.id } }"
              class="text-text-primary min-w-28 flex-1 truncate text-base leading-6 font-bold tracking-[-0.01em]"
            >
              {{ room.name }}
            </RouterLink>
            <div class="flex shrink-0 items-center gap-3.5">
              <span v-if="teamTagFor?.(room)" class="badge-pill badge-pill-neutral">
                {{ teamTagFor(room) }}
              </span>
              <span class="badge-pill badge-pill-neutral">{{ closedBadgeLabel }}</span>
              <span class="text-text-secondary text-xs font-medium">{{
                formatDate(room.createdAt)
              }}</span>
              <UDropdownMenu v-if="canManageRoom(room)" :items="archivedMenuItems(room)">
                <UButton
                  icon="i-lucide-ellipsis-vertical"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="hover:bg-surface-tertiary"
                  :aria-label="t('room.roomMenu')"
                />
              </UDropdownMenu>
            </div>
          </div>
        </div>
        <ListPagination :paging="archiveTabPaging" />
      </template>
    </template>
    <MoveEntityModal v-model:request="moveRequest" @moved="emit('moved')" />
  </div>
</template>
