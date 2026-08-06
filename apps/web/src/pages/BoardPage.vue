<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { BOARD_TITLE_MAX_LENGTH, hasTeamRole, type Board } from '@poker/shared';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import ConfirmModal from '../components/ConfirmModal.vue';
import { ApiError } from '../lib/api';
import { MODAL_BUTTON_UI, MODAL_INPUT_UI, MODAL_UI } from '../lib/modal-ui';
import { useBoardsStore } from '../stores/boards';
import { useSessionStore } from '../stores/session';
import { useTeamsStore } from '../stores/teams';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
const boards = useBoardsStore();
const teams = useTeamsStore();
const session = useSessionStore();

const loading = ref(true);
const notFound = ref(false);
const loadFailed = ref(false);
const board = ref<Board | null>(null);

const isArchived = computed(() => board.value?.status === 'archived');

/**
 * Личная доска доступна на чтение только владельцу (иначе сервер уже отдал бы
 * 404), поэтому раз мы её видим — мы её и можем администрировать. Командную
 * доску правит либо автор, либо администратор команды — роль подтягиваем
 * отдельно, страница команды её уже не отдаёт вместе со списком досок.
 */
const canManage = computed(() => {
  const b = board.value;
  if (!b) return false;
  if (!b.teamId) return true;
  if (b.ownerId === session.user?.id) return true;
  return !!teams.current && hasTeamRole(teams.current.role, 'admin');
});

watch(() => props.id, load, { immediate: true });

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  loadFailed.value = false;
  try {
    const snapshot = await boards.get(props.id);
    board.value = snapshot.board;
    if (snapshot.board.teamId) {
      await teams.loadTeam(snapshot.board.teamId);
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true;
    } else {
      loadFailed.value = true;
    }
  } finally {
    loading.value = false;
  }
}

// --- Переименование ---
const renameOpen = ref(false);
const renaming = ref(false);
const renameState = reactive({ title: '' });

watch(renameOpen, (open) => {
  renameState.title = open ? (board.value?.title ?? '') : '';
});

function validateTitle(s: { title: string }): FormError[] {
  const errors: FormError[] = [];
  const title = s.title.trim();
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

async function onRename(event: FormSubmitEvent<{ title: string }>): Promise<void> {
  renaming.value = true;
  try {
    board.value = await boards.rename(props.id, event.data.title.trim());
    toast.add({ title: t('board.renamed'), color: 'success', icon: 'i-lucide-check' });
    renameOpen.value = false;
  } catch {
    toast.add({ title: t('board.renameError'), color: 'error' });
  } finally {
    renaming.value = false;
  }
}

// --- Архивация / восстановление ---
const archiveOpen = ref(false);
const archiving = ref(false);

async function confirmArchive(): Promise<void> {
  archiving.value = true;
  try {
    board.value = await boards.archive(props.id);
    toast.add({ title: t('board.archivedToast'), color: 'success', icon: 'i-lucide-check' });
    archiveOpen.value = false;
  } catch {
    toast.add({ title: t('board.archiveError'), color: 'error' });
  } finally {
    archiving.value = false;
  }
}

const unarchiving = ref(false);

async function unarchive(): Promise<void> {
  unarchiving.value = true;
  try {
    board.value = await boards.unarchive(props.id);
    toast.add({ title: t('board.unarchived'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('board.unarchiveError'), color: 'error' });
  } finally {
    unarchiving.value = false;
  }
}

// --- Удаление навсегда ---
const deleteOpen = ref(false);
const deleting = ref(false);

async function confirmDelete(): Promise<void> {
  deleting.value = true;
  try {
    await boards.remove(props.id);
    toast.add({ title: t('board.deleted'), color: 'success', icon: 'i-lucide-check' });
    deleteOpen.value = false;
    await router.push({ name: 'boards' });
  } catch {
    toast.add({ title: t('board.deleteError'), color: 'error' });
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <section class="space-y-5">
    <UAlert v-if="notFound" color="error" variant="subtle" :description="t('board.notFound')" />
    <UAlert
      v-else-if="loadFailed"
      color="error"
      variant="subtle"
      :description="t('board.loadError')"
    />

    <div v-else-if="loading" class="space-y-5">
      <USkeleton class="h-9 w-1/3 bg-[var(--brand-border)]" />
      <USkeleton class="h-64 w-full rounded-[12px] bg-[var(--brand-border)]" />
    </div>

    <template v-else-if="board">
      <div class="flex flex-wrap items-start justify-between gap-3.5">
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex min-w-0 flex-wrap items-center gap-3">
            <h1 class="font-heading min-w-0 text-3xl font-extrabold break-words">
              {{ board.title }}
            </h1>
            <span v-if="isArchived" class="badge-pill badge-pill-neutral">{{
              t('board.archivedBadge')
            }}</span>
          </div>
          <span class="text-muted text-sm font-semibold">
            {{ board.teamId ? t('board.teamBoardSubtitle') : t('board.personalBoardSubtitle') }}
          </span>
        </div>

        <div v-if="canManage" class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="outline"
            class="rounded-[10px] px-[18px] py-[11px] text-sm font-bold"
            @click="renameOpen = true"
          >
            {{ t('board.rename') }}
          </UButton>
          <UButton
            v-if="!isArchived"
            icon="i-lucide-archive"
            color="neutral"
            variant="outline"
            class="rounded-[10px] px-[18px] py-[11px] text-sm font-bold"
            @click="archiveOpen = true"
          >
            {{ t('board.archive') }}
          </UButton>
          <template v-else>
            <UButton
              icon="i-lucide-rotate-ccw"
              color="neutral"
              variant="outline"
              class="rounded-[10px] px-[18px] py-[11px] text-sm font-bold"
              :loading="unarchiving"
              @click="unarchive"
            >
              {{ t('board.unarchive') }}
            </UButton>
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="subtle"
              class="rounded-[10px] px-[18px] py-[11px] text-sm font-bold"
              @click="deleteOpen = true"
            >
              {{ t('board.deleteBoard') }}
            </UButton>
          </template>
        </div>
      </div>

      <div
        class="surface-card text-muted flex min-h-64 items-center justify-center p-8 text-center text-sm"
      >
        {{ t('board.canvasComingSoon') }}
      </div>
    </template>

    <UModal v-model:open="renameOpen" :title="t('board.renameTitle')" :ui="MODAL_UI">
      <template #body>
        <UForm :state="renameState" :validate="validateTitle" class="space-y-4" @submit="onRename">
          <UFormField :label="t('teams.nameLabel')" name="title">
            <UInput
              v-model="renameState.title"
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
              @click="renameOpen = false"
            >
              {{ t('teams.cancel') }}
            </UButton>
            <UButton type="submit" :ui="MODAL_BUTTON_UI" :loading="renaming">
              {{ t('board.rename') }}
            </UButton>
          </div>
        </UForm>
      </template>
    </UModal>

    <ConfirmModal
      v-model:open="archiveOpen"
      :title="t('board.archiveConfirmTitle')"
      :description="t('board.archiveConfirmText')"
      :confirm-label="t('board.archiveConfirm')"
      confirm-color="primary"
      :loading="archiving"
      @confirm="confirmArchive"
    />

    <ConfirmModal
      v-model:open="deleteOpen"
      :title="t('board.deleteConfirmTitle')"
      :description="t('board.deleteConfirmText')"
      :confirm-label="t('board.deleteConfirm')"
      :loading="deleting"
      @confirm="confirmDelete"
    />
  </section>
</template>
