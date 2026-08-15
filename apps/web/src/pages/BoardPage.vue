<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import {
  BOARD_TITLE_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  hasBoardAccess,
  trimText,
  type Board,
} from '@poker/shared';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import BoardCanvas from '../components/board/BoardCanvas.vue';
import BoardShareModal from '../components/board/BoardShareModal.vue';
import ConfirmModal from '../components/ConfirmModal.vue';
import EntityTextModal from '../components/EntityTextModal.vue';
import { ApiError } from '../lib/api';
import { MODAL_BUTTON_UI, MODAL_INPUT_UI } from '../lib/modal-ui';
import { useAsyncAction } from '../composables/use-async-action';
import { useEntityModal } from '../composables/use-entity-modal';
import {
  archiveBoard as archiveBoardRequest,
  deleteBoard,
  getBoard,
  renameBoard as renameBoardRequest,
  unarchiveBoard,
} from '../features/boards/api/boards-api';
import { useBoardSessionStore } from '../stores/board-session';
import { useSessionStore } from '../stores/session';
import { useTeamsStore } from '../stores/teams';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
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
const canManage = computed(() => hasBoardAccess(boardSession.access, 'manage'));
const canEdit = computed(() => {
  if (board.value?.status === 'archived') return false;
  return hasBoardAccess(boardSession.access, 'edit');
});

/**
 * Сервер отклонил уже применённый оптимистично батч (14.4) — стор откатил
 * локальную правку сам, здесь только сообщаем причину. `not_found`/`forbidden`
 * во время `board:apply` означают именно потерю доступа (доска не найдена
 * заново — тот же анти-перебор код, что и у чужого/гостя без ссылки, либо
 * роль в команде понизили) — например, владелец сузил ссылку до «только
 * просмотр», пока участник уже редактировал. Подтягиваем свежий access,
 * иначе UI продолжал бы предлагать редактирование, которое сервер и дальше
 * будет отклонять.
 *
 * Троттлинг на 2с: жест (например, драг) шлёт патчи пачкой — без него урезание
 * доступа посреди активного перетаскивания дало бы тост на каждый отклонённый
 * тик жеста, а не один понятный тост на весь инцидент.
 */
const APPLY_ERROR_NOTICE_COOLDOWN_MS = 2000;
let lastApplyErrorNoticeAt = 0;

watch(
  () => boardSession.applyError,
  (err) => {
    if (!err) return;
    const now = Date.now();
    if (now - lastApplyErrorNoticeAt < APPLY_ERROR_NOTICE_COOLDOWN_MS) return;
    lastApplyErrorNoticeAt = now;

    if (err.code === 'forbidden' || err.code === 'not_found') {
      toast.add({ title: t('board.applyAccessChanged'), color: 'error' });
      void getBoard(props.id)
        .then((snapshot) => {
          boardSession.access = snapshot.access;
        })
        .catch(() => {
          // Не критично — следующий join/реконнект и так подтянет актуальный access
        });
    } else {
      toast.add({ title: t('board.applyErrorGeneric'), color: 'error' });
    }
  },
);

/** Гость называет имя один раз за вкладку — переживает перезагрузку, не переживает закрытие (по образцу RoomPage.vue) */
function readStoredGuestName(): string {
  try {
    return sessionStorage.getItem('poker:board-guest-name') ?? '';
  } catch {
    return '';
  }
}

function storeGuestName(name: string): void {
  try {
    sessionStorage.setItem('poker:board-guest-name', name);
  } catch {
    // Приватный режим браузера может запрещать хранилище — в рамках вкладки не критично
  }
}

const needsGuestName = ref(false);
const guestJoinFailed = ref(false);
const guestState = reactive({ name: readStoredGuestName() });

function validateGuestName(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = trimText(s.name);
  if (!name) {
    errors.push({ name: 'name', message: t('board.guestNameRequired') });
  } else if (name.length > GUEST_NAME_MAX_LENGTH) {
    errors.push({
      name: 'name',
      message: t('board.guestNameTooLong', { max: GUEST_NAME_MAX_LENGTH }),
    });
  }
  return errors;
}

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  loadFailed.value = false;
  needsGuestName.value = false;
  guestJoinFailed.value = false;
  try {
    const snapshot = await getBoard(props.id);
    board.value = snapshot.board;
    // REST-снимок уже знает наш access — синхронизируем в store, чтобы
    // canManage/canEdit отработали до первого WS `join`, а `canManage` можно
    // было поставить в prop BoardShareModal
    boardSession.access = snapshot.access;
    // Гость не может звать /api/teams/:id (роут только для вошедших) — иначе
    // командная доска, открытая гостю по ссылке, всегда падала бы в loadFailed
    if (snapshot.board.teamId && session.isAuthenticated) {
      await teams.loadTeam(snapshot.board.teamId);
    }

    if (session.isAuthenticated) {
      await joinBoard();
    } else {
      // Реалтайм-вход гостю требует имени — показываем форму вместо немедленного join
      needsGuestName.value = true;
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

/**
 * WS-вход отдельно от REST-снимка выше. При провале реконнекта (доступ
 * отозвали, пока вкладка простаивала, и т.п.) синк молча не оживёт сам —
 * предупреждаем и предлагаем перезайти на доску. Провал самого первого входа
 * ловит вызывающий код: для гостя это открытая форма имени, для вошедшего —
 * тост ниже.
 */
async function joinBoard(guestName?: string): Promise<void> {
  await boardSession.join(props.id, guestName, () => {
    toast.add({ title: t('board.loadError'), color: 'error' });
  });
}

const { pending: guestJoining, execute: joinAsGuest } = useAsyncAction({
  run: (name: string) => joinBoard(name),
  success: () => {
    needsGuestName.value = false;
  },
  error: () => {
    guestJoinFailed.value = true;
  },
});

async function onGuestNameSubmit(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  const name = trimText(event.data.name);
  storeGuestName(name);
  guestJoinFailed.value = false;
  await joinAsGuest(name);
}

// immediate: true запускает load() синхронно прямо здесь — она читает состояние
// формы гостя выше (needsGuestName и т.п.), поэтому watch объявлен уже после него
watch(() => props.id, load, { immediate: true });

// REST-снимок уже загружен через `boards.get` выше — WS-вход (12.4) даёт только
// реалтайм-синхронизацию поверх него, поэтому его результат ожидать не нужно
onBeforeUnmount(() => {
  boardSession.leave();
});

// --- Переименование ---
const shareOpen = ref(false);
const renameModal = useEntityModal();

const { pending: renaming, execute: renameBoard } = useAsyncAction({
  run: (title: string) => renameBoardRequest(props.id, title),
  success: (updated) => {
    board.value = updated;
    toast.add({ title: t('board.renamed'), color: 'success', icon: 'i-lucide-check' });
    renameModal.close();
  },
  error: () => {
    toast.add({ title: t('board.renameError'), color: 'error' });
  },
});

async function onRename(title: string): Promise<void> {
  await renameBoard(title);
}

// --- Архивация / восстановление ---
const archiveOpen = ref(false);

const { pending: archiving, execute: archiveBoard } = useAsyncAction({
  run: () => archiveBoardRequest(props.id),
  success: (updated) => {
    board.value = updated;
    toast.add({ title: t('board.archivedToast'), color: 'success', icon: 'i-lucide-check' });
    archiveOpen.value = false;
  },
  error: () => {
    toast.add({ title: t('board.archiveError'), color: 'error' });
  },
});

async function confirmArchive(): Promise<void> {
  await archiveBoard();
}

async function unarchive(): Promise<void> {
  try {
    board.value = await unarchiveBoard(props.id);
    toast.add({ title: t('board.unarchived'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('board.unarchiveError'), color: 'error' });
  }
}

// --- Удаление навсегда ---
const deleteOpen = ref(false);

const { pending: deleting, execute: removeBoard } = useAsyncAction({
  run: () => deleteBoard(props.id),
  success: async () => {
    toast.add({ title: t('board.deleted'), color: 'success', icon: 'i-lucide-check' });
    deleteOpen.value = false;
    await router.push({ name: 'boards' });
  },
  error: () => {
    toast.add({ title: t('board.deleteError'), color: 'error' });
  },
});

async function confirmDelete(): Promise<void> {
  await removeBoard();
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

    <!-- Гость на доске по ссылке (14.4): реалтайм-вход и presence нужны имени,
    поэтому просим представиться прежде, чем показать холст -->
    <div
      v-if="board && needsGuestName"
      class="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4"
    >
      <h1 class="font-heading mb-4 text-2xl font-extrabold">{{ board.title }}</h1>
      <div class="surface-card surface-card-lg px-4 py-5 sm:px-[30px] sm:py-[26px]">
        <h2 class="mb-[18px] text-[17px] font-bold">{{ t('board.guestNameTitle') }}</h2>
        <UForm
          :state="guestState"
          :validate="validateGuestName"
          class="space-y-4"
          @submit="onGuestNameSubmit"
        >
          <UFormField :label="t('board.guestName')" name="name">
            <UInput
              v-model="guestState.name"
              :placeholder="t('board.guestNamePlaceholder')"
              :maxlength="GUEST_NAME_MAX_LENGTH"
              autofocus
              class="w-full"
              :ui="MODAL_INPUT_UI"
            />
          </UFormField>
          <UAlert
            v-if="guestJoinFailed"
            color="error"
            variant="subtle"
            :description="t('board.guestJoinError')"
          />
          <UButton type="submit" block :ui="MODAL_BUTTON_UI" :loading="guestJoining">
            {{ t('board.guestJoin') }}
          </UButton>
        </UForm>
      </div>
    </div>

    <!-- Холст владеет всем остатком экрана (без общего max-width-контейнера страницы, 12.5) —
    название доски и её меню теперь плашкой поверх холста, а не отдельным рядом над ним -->
    <div v-if="board && !needsGuestName" class="min-h-0 flex-1">
      <BoardCanvas
        :board="board"
        :team-name="board.teamId ? (teams.current?.team.name ?? null) : null"
        :can-manage="canManage"
        :can-edit="canEdit"
        :items="boardSession.items"
        :edges="boardSession.edges"
        @rename="renameModal.show"
        @archive="archiveOpen = true"
        @unarchive="unarchive"
        @share="shareOpen = true"
        @delete="deleteOpen = true"
      />
    </div>
  </div>

  <EntityTextModal
    v-model:open="renameModal.open"
    :title="t('board.renameTitle')"
    :label="t('common.nameLabel')"
    :initial-value="board?.title ?? ''"
    :max-length="BOARD_TITLE_MAX_LENGTH"
    :required-message="t('common.nameRequired')"
    :too-long-message="t('common.nameTooLong', { max: BOARD_TITLE_MAX_LENGTH })"
    :cancel-label="t('common.cancel')"
    :submit-label="t('board.rename')"
    :pending="renaming"
    @submit="onRename"
  />

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

  <BoardShareModal v-if="board" v-model="shareOpen" :board="board" />
</template>
