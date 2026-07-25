<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import {
  hasTeamRole,
  ROOM_NAME_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  TEAM_ROLES,
  type Room,
  type TeamMember,
  type TeamRole,
} from '@poker/shared';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { ApiError } from '../lib/api';
import { roleBadgeColor } from '../lib/team-roles';
import { useRoomsStore } from '../stores/rooms';
import { useSessionStore } from '../stores/session';
import { useTeamRoomsStore } from '../stores/team-rooms';
import { useTeamsStore } from '../stores/teams';

const props = defineProps<{ id: string }>();

const { t, locale } = useI18n();
const toast = useToast();
const router = useRouter();
const teams = useTeamsStore();
const teamRooms = useTeamRoomsStore();
const rooms = useRoomsStore();
const session = useSessionStore();

const loading = ref(true);
const notFound = ref(false);
const loadFailed = ref(false);
/** Комнаты грузятся отдельно: их сбой не должен прятать саму команду */
const roomsFailed = ref(false);

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

/** Дашборд комнат: активные и завершённые одним списком секций, чтобы не
 * дублировать разметку строки. */
const roomSections = computed(() => [
  {
    key: 'active',
    title: t('team.roomsActive'),
    badge: t('team.roomActive'),
    color: 'success' as const,
    rooms: teamRooms.active,
  },
  {
    key: 'closed',
    title: t('team.roomsClosed'),
    badge: t('team.roomClosed'),
    color: 'neutral' as const,
    rooms: teamRooms.closed,
  },
]);

/** Код приходит только администратору — по нему и показываем блок приглашения */
const inviteUrl = computed(() =>
  overview.value?.inviteCode
    ? `${window.location.origin}/invite/${overview.value.inviteCode}`
    : null,
);

// immediate — грузим при заходе; watch — на случай перехода между командами,
// когда vue-router переиспользует компонент и onMounted повторно не срабатывает
watch(() => props.id, load, { immediate: true });

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  loadFailed.value = false;
  roomsFailed.value = false;
  teamRooms.reset();
  try {
    await teams.loadTeam(props.id);
    // Дашборд команды: комнаты тянем следом, их ошибку ловим отдельно ниже
    await loadRooms();
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

// --- Архив комнат команды: виден только администратору, грузится по требованию ---
const archiveOpen = ref(false);
const archiveLoading = ref(false);
const archiveFailed = ref(false);
let archiveLoaded = false;

async function toggleArchive(): Promise<void> {
  archiveOpen.value = !archiveOpen.value;
  if (archiveOpen.value && !archiveLoaded) {
    archiveLoading.value = true;
    archiveFailed.value = false;
    try {
      await teamRooms.loadArchived(props.id);
      archiveLoaded = true;
    } catch {
      archiveFailed.value = true;
    } finally {
      archiveLoading.value = false;
    }
  }
}

const deleteRoomTarget = ref<Room | null>(null);
const deleteRoomOpen = ref(false);
const deletingRoom = ref(false);

function askDeleteRoom(room: Room): void {
  deleteRoomTarget.value = room;
  deleteRoomOpen.value = true;
}

async function confirmDeleteRoom(): Promise<void> {
  const target = deleteRoomTarget.value;
  if (!target) return;
  deletingRoom.value = true;
  try {
    await rooms.remove(target.id);
    await teamRooms.loadArchived(props.id);
    toast.add({ title: t('team.archiveDeleted'), color: 'success', icon: 'i-lucide-check' });
    deleteRoomOpen.value = false;
  } catch {
    toast.add({ title: t('team.archiveDeleteError'), color: 'error' });
  } finally {
    deletingRoom.value = false;
  }
}

// --- Создание комнаты от лица команды ---
const createRoomOpen = ref(false);
const creatingRoom = ref(false);
const createRoomState = reactive({ name: '' });

watch(createRoomOpen, (isOpen) => {
  if (!isOpen) createRoomState.name = '';
});

function validateRoomName(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = s.name.trim();
  if (!name) {
    errors.push({ name: 'name', message: t('teams.nameRequired') });
  } else if (name.length > ROOM_NAME_MAX_LENGTH) {
    errors.push({ name: 'name', message: t('teams.nameTooLong', { max: ROOM_NAME_MAX_LENGTH }) });
  }
  return errors;
}

async function onCreateRoom(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  creatingRoom.value = true;
  try {
    const room = await rooms.create(event.data.name.trim(), props.id);
    createRoomOpen.value = false;
    await router.push({ name: 'room', params: { id: room.id } });
  } catch {
    toast.add({ title: t('room.createError'), color: 'error' });
  } finally {
    creatingRoom.value = false;
  }
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
const rotating = ref(false);

async function rotate(): Promise<void> {
  rotating.value = true;
  try {
    await teams.rotateInvite(props.id);
    toast.add({ title: t('team.rotated'), color: 'success', icon: 'i-lucide-check' });
    rotateOpen.value = false;
  } catch {
    toast.add({ title: t('team.rotateError'), color: 'error' });
  } finally {
    rotating.value = false;
  }
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
const leaving = ref(false);

async function confirmLeave(): Promise<void> {
  const userId = currentUserId.value;
  if (!userId) return;
  leaving.value = true;
  try {
    await teams.removeMember(props.id, userId);
    toast.add({ title: t('team.left'), color: 'success', icon: 'i-lucide-check' });
    leaveOpen.value = false;
    await router.push({ name: 'teams' });
  } catch (err) {
    // Единственному администратору бэкенд отвечает 409 — сначала назначить другого
    const key = err instanceof ApiError && err.status === 409 ? 'leaveLastAdmin' : 'leaveError';
    toast.add({ title: t(`team.${key}`), color: 'error' });
  } finally {
    leaving.value = false;
  }
}

// --- Переименование ---
const renameOpen = ref(false);
const renaming = ref(false);
const renameState = reactive({ name: '' });

// Открыли — подставляем текущее имя; закрыли — очищаем, чтобы не мигало старое
watch(renameOpen, (open) => {
  renameState.name = open ? (overview.value?.team.name ?? '') : '';
});

function validateName(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = s.name.trim();
  if (!name) {
    errors.push({ name: 'name', message: t('teams.nameRequired') });
  } else if (name.length > TEAM_NAME_MAX_LENGTH) {
    errors.push({ name: 'name', message: t('teams.nameTooLong', { max: TEAM_NAME_MAX_LENGTH }) });
  }
  return errors;
}

async function onRename(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  renaming.value = true;
  try {
    await teams.rename(props.id, event.data.name.trim());
    toast.add({ title: t('team.renamed'), color: 'success', icon: 'i-lucide-check' });
    renameOpen.value = false;
  } catch {
    toast.add({ title: t('team.renameError'), color: 'error' });
  } finally {
    renaming.value = false;
  }
}

// --- Удаление команды ---
const deleteOpen = ref(false);
const deleting = ref(false);

async function confirmDelete(): Promise<void> {
  deleting.value = true;
  try {
    await teams.remove(props.id);
    toast.add({ title: t('team.deleted'), color: 'success', icon: 'i-lucide-check' });
    deleteOpen.value = false;
    await router.push({ name: 'teams' });
  } catch {
    toast.add({ title: t('team.deleteError'), color: 'error' });
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <section class="space-y-6">
    <RouterLink :to="{ name: 'teams' }" class="text-muted hover:text-default inline-flex text-sm">
      ← {{ t('team.back') }}
    </RouterLink>

    <UAlert v-if="notFound" color="error" variant="subtle" :description="t('team.notFound')" />
    <UAlert
      v-else-if="loadFailed"
      color="error"
      variant="subtle"
      :description="t('team.loadError')"
    />

    <div v-else-if="loading" class="text-muted flex justify-center py-8">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
    </div>

    <template v-else-if="overview">
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-semibold">{{ overview.team.name }}</h1>
        <UBadge :color="roleBadgeColor(overview.role)" variant="subtle">
          {{ t(`role.${overview.role}`) }}
        </UBadge>
      </div>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-medium">{{ t('team.roomsTitle') }}</h2>
            <UButton
              v-if="canManageTeam"
              icon="i-lucide-plus"
              size="sm"
              @click="createRoomOpen = true"
            >
              {{ t('room.create') }}
            </UButton>
          </div>
        </template>

        <UAlert
          v-if="roomsFailed"
          color="error"
          variant="subtle"
          :description="t('team.roomsError')"
        />
        <p v-else-if="teamRooms.list.length === 0" class="text-muted text-sm">
          {{ t('team.roomsEmpty') }}
        </p>
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
                  <UBadge :color="section.color" variant="subtle">{{ section.badge }}</UBadge>
                </RouterLink>
              </li>
            </ul>
          </div>
        </div>
      </UCard>

      <UCard v-if="canManageTeam">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-medium">{{ t('team.archiveTitle') }}</h2>
            <UButton color="neutral" variant="ghost" size="sm" @click="toggleArchive">
              {{ archiveOpen ? t('team.archiveHide') : t('team.archiveShow') }}
            </UButton>
          </div>
        </template>

        <template v-if="archiveOpen">
          <UAlert
            v-if="archiveFailed"
            color="error"
            variant="subtle"
            :description="t('team.archiveError')"
          />
          <div v-else-if="archiveLoading" class="text-muted flex justify-center py-4">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          </div>
          <p v-else-if="teamRooms.archived.length === 0" class="text-muted text-sm">
            {{ t('team.archiveEmpty') }}
          </p>
          <ul v-else class="divide-default divide-y">
            <li
              v-for="room in teamRooms.archived"
              :key="room.id"
              class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <RouterLink
                :to="{ name: 'room', params: { id: room.id } }"
                class="min-w-0 flex-1 truncate"
              >
                {{ room.name }}
              </RouterLink>
              <span class="text-muted text-xs">{{ formatDate(room.createdAt) }}</span>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                @click="askDeleteRoom(room)"
              >
                {{ t('team.archiveDeleteRoom') }}
              </UButton>
            </li>
          </ul>
        </template>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-medium">{{ t('team.membersTitle') }}</h2>
        </template>
        <ul class="divide-default divide-y">
          <li
            v-for="member in overview.members"
            :key="member.userId"
            class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <UAvatar :src="member.avatarUrl ?? undefined" :alt="member.name" size="sm" />
            <span class="min-w-0 flex-1 truncate">{{ member.name }}</span>

            <!-- Администратор меняет роли всем, кроме себя; себе показываем бейдж -->
            <USelect
              v-if="canManageTeam && member.userId !== currentUserId"
              :model-value="member.role"
              :items="roleItems"
              value-key="value"
              :aria-label="t('team.roleLabel')"
              :disabled="isBusy(member.userId)"
              class="w-40"
              @update:model-value="onRoleChange(member, $event as TeamRole)"
            />
            <UBadge v-else :color="roleBadgeColor(member.role)" variant="subtle">
              {{ t(`role.${member.role}`) }}
            </UBadge>

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
          </li>
        </ul>
      </UCard>

      <UCard v-if="inviteUrl">
        <template #header>
          <h2 class="font-medium">{{ t('team.inviteTitle') }}</h2>
        </template>
        <div class="space-y-3">
          <p class="text-muted text-sm">{{ t('team.inviteHint') }}</p>
          <div class="flex flex-wrap items-center gap-2">
            <UInput :model-value="inviteUrl" readonly class="grow" :ui="{ base: 'font-mono' }" />
            <UButton icon="i-lucide-copy" color="neutral" variant="subtle" @click="copyInvite">
              {{ t('team.copy') }}
            </UButton>
          </div>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="rotateOpen = true"
          >
            {{ t('team.rotate') }}
          </UButton>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-medium">{{ t('team.settingsTitle') }}</h2>
        </template>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="canManageTeam"
            icon="i-lucide-pencil"
            color="neutral"
            variant="subtle"
            @click="renameOpen = true"
          >
            {{ t('team.rename') }}
          </UButton>
          <!-- Выйти может любой участник; единственному администратору бэкенд
               откажет (409) и предложит сначала назначить другого -->
          <UButton
            icon="i-lucide-log-out"
            color="neutral"
            variant="subtle"
            @click="leaveOpen = true"
          >
            {{ t('team.leave') }}
          </UButton>
          <UButton
            v-if="canManageTeam"
            icon="i-lucide-trash-2"
            color="error"
            variant="subtle"
            @click="deleteOpen = true"
          >
            {{ t('team.deleteTeam') }}
          </UButton>
        </div>
      </UCard>
    </template>

    <UModal
      v-model:open="rotateOpen"
      :title="t('team.rotateConfirmTitle')"
      :description="t('team.rotateConfirmText')"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton color="error" :loading="rotating" @click="rotate">
          {{ t('team.rotateConfirm') }}
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="removeOpen"
      :title="t('team.removeConfirmTitle')"
      :description="t('team.removeConfirmText', { name: removeTarget?.name ?? '' })"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton
          color="error"
          :loading="removeTarget ? isBusy(removeTarget.userId) : false"
          @click="confirmRemove"
        >
          {{ t('team.removeConfirm') }}
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="leaveOpen"
      :title="t('team.leaveConfirmTitle')"
      :description="t('team.leaveConfirmText')"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton color="error" :loading="leaving" @click="confirmLeave">
          {{ t('team.leaveConfirm') }}
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteRoomOpen"
      :title="t('team.archiveDeleteConfirmTitle')"
      :description="t('team.archiveDeleteConfirmText', { name: deleteRoomTarget?.name ?? '' })"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton color="error" :loading="deletingRoom" @click="confirmDeleteRoom">
          {{ t('team.archiveDeleteConfirm') }}
        </UButton>
      </template>
    </UModal>

    <UModal v-model:open="createRoomOpen" :title="t('room.createTitle')">
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
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="createRoomOpen = false">
              {{ t('teams.cancel') }}
            </UButton>
            <UButton type="submit" :loading="creatingRoom">
              {{ creatingRoom ? t('room.creating') : t('room.create') }}
            </UButton>
          </div>
        </UForm>
      </template>
    </UModal>

    <UModal v-model:open="renameOpen" :title="t('team.renameTitle')">
      <template #body>
        <UForm :state="renameState" :validate="validateName" class="space-y-4" @submit="onRename">
          <UFormField :label="t('teams.nameLabel')" name="name">
            <UInput
              v-model="renameState.name"
              :placeholder="t('teams.namePlaceholder')"
              :maxlength="TEAM_NAME_MAX_LENGTH"
              autofocus
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="renameOpen = false">
              {{ t('teams.cancel') }}
            </UButton>
            <UButton type="submit" :loading="renaming">{{ t('team.rename') }}</UButton>
          </div>
        </UForm>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteOpen"
      :title="t('team.deleteConfirmTitle')"
      :description="t('team.deleteConfirmText')"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton color="error" :loading="deleting" @click="confirmDelete">
          {{ t('team.deleteConfirm') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
