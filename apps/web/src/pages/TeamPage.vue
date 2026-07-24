<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { TEAM_NAME_MAX_LENGTH, TEAM_ROLES, type TeamMember, type TeamRole } from '@poker/shared';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { ApiError } from '../lib/api';
import { roleBadgeColor } from '../lib/team-roles';
import { useSessionStore } from '../stores/session';
import { useTeamsStore } from '../stores/teams';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
const teams = useTeamsStore();
const session = useSessionStore();

const loading = ref(true);
const notFound = ref(false);
const loadFailed = ref(false);

const overview = computed(() => teams.current);
const currentUserId = computed(() => session.user?.id ?? null);
/** Управлять составом (роли, исключение) может только владелец */
const isOwner = computed(() => overview.value?.role === 'owner');

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

/** Код приходит только админу и владельцу — по нему и показываем блок приглашения */
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
  try {
    await teams.loadTeam(props.id);
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

// --- Смена роли и передача владения ---
const transferTarget = ref<TeamMember | null>(null);
const transferOpen = ref(false);

/** Владельца назначаем только через подтверждение — это передача владения */
async function onRoleChange(member: TeamMember, role: TeamRole): Promise<void> {
  if (role === member.role) return;
  if (role === 'owner') {
    transferTarget.value = member;
    transferOpen.value = true;
    return;
  }
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

async function confirmTransfer(): Promise<void> {
  const target = transferTarget.value;
  if (!target) return;
  setBusy(target.userId, true);
  try {
    await teams.changeMemberRole(props.id, target.userId, 'owner');
    toast.add({ title: t('team.ownerTransferred'), color: 'success', icon: 'i-lucide-check' });
    transferOpen.value = false;
  } catch {
    toast.add({ title: t('team.roleChangeError'), color: 'error' });
  } finally {
    setBusy(target.userId, false);
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
    // Единственному владельцу бэкенд отвечает 409 — сначала передать владение
    const key = err instanceof ApiError && err.status === 409 ? 'leaveLastOwner' : 'leaveError';
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

            <!-- Владелец меняет роли всем, кроме себя; себе показываем бейдж -->
            <USelect
              v-if="isOwner && member.userId !== currentUserId"
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
              v-if="isOwner && member.userId !== currentUserId"
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
            v-if="isOwner"
            icon="i-lucide-pencil"
            color="neutral"
            variant="subtle"
            @click="renameOpen = true"
          >
            {{ t('team.rename') }}
          </UButton>
          <!-- Владелец в команде единственный: выйти он может только передав
               владение или удалив команду, поэтому кнопку «Выйти» ему не показываем -->
          <UButton
            v-if="!isOwner"
            icon="i-lucide-log-out"
            color="neutral"
            variant="subtle"
            @click="leaveOpen = true"
          >
            {{ t('team.leave') }}
          </UButton>
          <UButton
            v-if="isOwner"
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
      v-model:open="transferOpen"
      :title="t('team.transferTitle')"
      :description="t('team.transferText', { name: transferTarget?.name ?? '' })"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton
          color="error"
          :loading="transferTarget ? isBusy(transferTarget.userId) : false"
          @click="confirmTransfer"
        >
          {{ t('team.transferConfirm') }}
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
