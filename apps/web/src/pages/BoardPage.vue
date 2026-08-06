<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { BOARD_TITLE_MAX_LENGTH, hasTeamRole, type Board } from '@poker/shared';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import BoardCanvas from '../components/board/BoardCanvas.vue';
import ConfirmModal from '../components/ConfirmModal.vue';
import { ApiError } from '../lib/api';
import { MODAL_BUTTON_UI, MODAL_INPUT_UI, MODAL_UI } from '../lib/modal-ui';
import { useBoardsStore } from '../stores/boards';
import { useBoardSessionStore } from '../stores/board-session';
import { useSessionStore } from '../stores/session';
import { useTeamsStore } from '../stores/teams';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
const boards = useBoardsStore();
const teams = useTeamsStore();
const session = useSessionStore();
const boardSession = useBoardSessionStore();

const loading = ref(true);
const notFound = ref(false);
const loadFailed = ref(false);
const board = ref<Board | null>(null);

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
    void boardSession.join(props.id);
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

// REST-снимок уже загружен через `boards.get` выше — WS-вход (12.4) даёт только
// реалтайм-синхронизацию поверх него, поэтому его результат ожидать не нужно
onBeforeUnmount(() => {
  boardSession.leave();
});

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

async function unarchive(): Promise<void> {
  try {
    board.value = await boards.unarchive(props.id);
    toast.add({ title: t('board.unarchived'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('board.unarchiveError'), color: 'error' });
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
  <div class="flex h-full min-h-0 flex-1 flex-col">
    <div v-if="!board" class="mx-auto w-full max-w-[73.75rem] px-4 pt-8 pb-5 md:px-14 md:pt-14">
      <UAlert v-if="notFound" color="error" variant="subtle" :description="t('board.notFound')" />
      <UAlert
        v-else-if="loadFailed"
        color="error"
        variant="subtle"
        :description="t('board.loadError')"
      />

      <div v-else-if="loading" class="space-y-5">
        <USkeleton class="h-9 w-1/3 bg-[var(--brand-border)]" />
        <USkeleton class="h-16 w-full rounded-[12px] bg-[var(--brand-border)]" />
      </div>
    </div>

    <!-- Холст владеет всем остатком экрана (без общего max-width-контейнера страницы, 12.5) —
    название доски и её меню теперь плашкой поверх холста, а не отдельным рядом над ним -->
    <div v-if="board" class="min-h-0 flex-1">
      <BoardCanvas
        :board="board"
        :team-name="board.teamId ? (teams.current?.team.name ?? null) : null"
        :can-manage="canManage"
        :items="boardSession.items"
        :edges="boardSession.edges"
        @rename="renameOpen = true"
        @archive="archiveOpen = true"
        @unarchive="unarchive"
        @delete="deleteOpen = true"
      />
    </div>
  </div>

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
</template>
