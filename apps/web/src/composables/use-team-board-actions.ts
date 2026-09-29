import type { BoardSummary } from '@estimate/shared';
import { useToast } from '@nuxt/ui/composables';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  archiveBoard as archiveBoardRequest,
  deleteBoard as deleteBoardRequest,
  renameBoard as renameBoardRequest,
  unarchiveBoard as unarchiveBoardRequest,
} from '../features/boards/api/boards-api';
import { useAsyncAction } from './use-async-action';
import { useEntityModal } from './use-entity-modal';

/**
 * Переименование/архивация/восстановление/удаление доски команды из кебаб-меню
 * карточки (08_Boards) — вынесено из TeamPage.vue отдельным composable, чтобы не
 * разрастать файл страницы (лимит 700 строк, max-lines): у досок, в отличие от
 * комнат, есть ещё и восстановление из архива, и все четыре действия вместе
 * складываются в самодостаточный блок, не завязанный на остальной стейт страницы.
 */
export function useTeamBoardActions(options: {
  reloadActive: () => Promise<void>;
  reloadArchived: () => Promise<void>;
}) {
  const toast = useToast();
  const { t } = useI18n();

  /** Переименованная/заархивированная доска может быть на любой из двух вкладок;
   * сбой тихой довозгрузки архива не должен превращать успешное действие в error-тост. */
  async function reloadAfterMutation(): Promise<void> {
    await options.reloadActive();
    try {
      await options.reloadArchived();
    } catch {
      // Архив обновится при следующем открытии вкладки — не критично
    }
  }

  // --- Переименование ---
  const renameBoardTarget = ref<BoardSummary | null>(null);
  const renameBoardModal = useEntityModal();

  function askRenameBoard(board: BoardSummary): void {
    renameBoardTarget.value = board;
    renameBoardModal.show();
  }

  const { pending: renamingBoard, execute: renameBoardExec } = useAsyncAction({
    run: (title: string) => {
      const target = renameBoardTarget.value;
      if (!target) return Promise.reject(new Error('no rename target'));
      return renameBoardRequest(target.id, title);
    },
    success: async () => {
      renameBoardModal.close();
      toast.add({ title: t('board.renamed'), color: 'success', icon: 'i-lucide-check' });
      await reloadAfterMutation();
    },
    error: () => {
      toast.add({ title: t('board.renameError'), color: 'error' });
    },
  });

  async function onRenameBoard(title: string): Promise<void> {
    if (!renameBoardTarget.value) return;
    await renameBoardExec(title);
  }

  // --- Архивация ---
  const archiveBoardTarget = ref<BoardSummary | null>(null);
  const archiveBoardOpen = ref(false);

  function askArchiveBoard(board: BoardSummary): void {
    archiveBoardTarget.value = board;
    archiveBoardOpen.value = true;
  }

  const { pending: archivingBoard, execute: archiveBoardExec } = useAsyncAction({
    run: (target: BoardSummary) => archiveBoardRequest(target.id),
    success: async () => {
      archiveBoardOpen.value = false;
      toast.add({ title: t('board.archivedToast'), color: 'success', icon: 'i-lucide-check' });
      await reloadAfterMutation();
    },
    error: () => {
      toast.add({ title: t('board.archiveError'), color: 'error' });
    },
  });

  async function confirmArchiveBoard(): Promise<void> {
    const target = archiveBoardTarget.value;
    if (!target) return;
    await archiveBoardExec(target);
  }

  // --- Восстановление из архива ---
  async function unarchiveBoard(board: BoardSummary): Promise<void> {
    try {
      await unarchiveBoardRequest(board.id);
      await reloadAfterMutation();
      toast.add({
        title: t('team.archiveBoardUnarchived'),
        color: 'success',
        icon: 'i-lucide-check',
      });
    } catch {
      toast.add({ title: t('team.archiveBoardUnarchiveError'), color: 'error' });
    }
  }

  // --- Удаление (доступно только для уже заархивированной доски) ---
  const deleteBoardTarget = ref<BoardSummary | null>(null);
  const deleteBoardOpen = ref(false);

  function askDeleteBoard(board: BoardSummary): void {
    deleteBoardTarget.value = board;
    deleteBoardOpen.value = true;
  }

  const { pending: deletingBoard, execute: deleteBoardExec } = useAsyncAction({
    run: (target: BoardSummary) => deleteBoardRequest(target.id),
    success: async () => {
      await options.reloadArchived();
      toast.add({ title: t('team.archiveBoardDeleted'), color: 'success', icon: 'i-lucide-check' });
      deleteBoardOpen.value = false;
    },
    error: () => {
      toast.add({ title: t('team.archiveBoardDeleteError'), color: 'error' });
    },
  });

  async function confirmDeleteBoard(): Promise<void> {
    const target = deleteBoardTarget.value;
    if (!target) return;
    await deleteBoardExec(target);
  }

  return {
    renameBoardTarget,
    renameBoardModal,
    askRenameBoard,
    renamingBoard,
    onRenameBoard,
    archiveBoardTarget,
    archiveBoardOpen,
    askArchiveBoard,
    archivingBoard,
    confirmArchiveBoard,
    unarchiveBoard,
    deleteBoardTarget,
    deleteBoardOpen,
    askDeleteBoard,
    deletingBoard,
    confirmDeleteBoard,
  };
}
