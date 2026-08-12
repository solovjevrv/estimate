<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import {
  BOARD_TITLE_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  hasBoardAccess,
  type Board,
} from '@poker/shared';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import BoardCanvas from '../components/board/BoardCanvas.vue';
import BoardShareModal from '../components/board/BoardShareModal.vue';
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
      void boards
        .get(props.id)
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
const guestJoining = ref(false);
const guestJoinFailed = ref(false);
const guestState = reactive({ name: readStoredGuestName() });

function validateGuestName(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = s.name.trim();
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
    const snapshot = await boards.get(props.id);
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

async function onGuestNameSubmit(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  const name = event.data.name.trim();
  storeGuestName(name);
  guestJoining.value = true;
  guestJoinFailed.value = false;
  try {
    await joinBoard(name);
    needsGuestName.value = false;
  } catch {
    guestJoinFailed.value = true;
  } finally {
    guestJoining.value = false;
  }
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
const renameOpen = ref(false);
const shareOpen = ref(false);
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
        @rename="renameOpen = true"
        @archive="archiveOpen = true"
        @unarchive="unarchive"
        @share="shareOpen = true"
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

  <BoardShareModal v-if="board" v-model="shareOpen" :board="board" />
</template>
