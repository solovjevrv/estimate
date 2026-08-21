/** Действия скрам-мастера над комнатой: архивация, переименование (7.20), исключение участника (5.8) */
import { useToast } from '@nuxt/ui/composables';
import type { Participant, Room } from '@poker/shared';
import { ref, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useAsyncAction } from '../../../composables/use-async-action';
import { useEntityModal, type EntityModal } from '../../../composables/use-entity-modal';
import { archiveRoom, renameRoom } from '../api/rooms-api';
import type { useRoomStore } from '../../../stores/room';

export interface UseRoomAdminActionsOptions {
  roomId: () => string;
  room: ReturnType<typeof useRoomStore>;
  /** Переименование меняет заголовок страницы (`roomInfo`) — страница остаётся владельцем этого состояния */
  onRoomRenamed: (renamed: Room) => void;
}

export function useRoomAdminActions(options: UseRoomAdminActionsOptions): {
  archiveOpen: Ref<boolean>;
  archiving: Readonly<Ref<boolean>>;
  onArchive: () => Promise<void>;
  renameModal: EntityModal;
  renaming: Readonly<Ref<boolean>>;
  onRename: (name: string) => Promise<void>;
  kickTarget: Ref<Participant | null>;
  kickConfirmOpen: Ref<boolean>;
  kicking: Readonly<Ref<boolean>>;
  onKickClick: (participant: Participant) => void;
  onKickConfirm: () => Promise<void>;
} {
  const { t } = useI18n();
  const toast = useToast();
  const { room } = options;

  const archiveOpen = ref(false);

  const { pending: archiving, execute: archive } = useAsyncAction({
    run: () => archiveRoom(options.roomId()),
    success: (archivedRoom) => {
      const current = room.state;
      if (current) {
        room.applyState({ ...current, room: archivedRoom });
      }
      archiveOpen.value = false;
      toast.add({ title: t('room.archivedToast'), color: 'success', icon: 'i-lucide-check' });
    },
    error: () => {
      toast.add({ title: t('room.archiveError'), color: 'error' });
    },
  });

  async function onArchive(): Promise<void> {
    await archive();
  }

  const renameModal = useEntityModal();

  const { pending: renaming, execute: rename } = useAsyncAction({
    run: (name: string) => renameRoom(options.roomId(), name),
    success: (renamed) => {
      options.onRoomRenamed(renamed);
      const current = room.state;
      if (current) {
        room.applyState({ ...current, room: renamed });
      }
      renameModal.close();
      toast.add({ title: t('room.renamed'), color: 'success', icon: 'i-lucide-check' });
    },
    error: () => {
      toast.add({ title: t('room.renameError'), color: 'error' });
    },
  });

  async function onRename(name: string): Promise<void> {
    await rename(name);
  }

  const kickTarget = ref<Participant | null>(null);
  const kickConfirmOpen = ref(false);

  function onKickClick(participant: Participant): void {
    kickTarget.value = participant;
    kickConfirmOpen.value = true;
  }

  const { pending: kicking, execute: kick } = useAsyncAction<[Participant], void>({
    run: (target) => room.kickParticipant(target.participantId),
    success: (_, target) => {
      kickConfirmOpen.value = false;
      toast.add({
        title: t('room.kickedParticipantToast', { name: target.name }),
        color: 'success',
        icon: 'i-lucide-check',
      });
    },
    error: () => {
      toast.add({ title: t('room.kickError'), color: 'error' });
    },
  });

  async function onKickConfirm(): Promise<void> {
    const target = kickTarget.value;
    if (!target) return;
    await kick(target);
  }

  return {
    archiveOpen,
    archiving,
    onArchive,
    renameModal,
    renaming,
    onRename,
    kickTarget,
    kickConfirmOpen,
    kicking,
    onKickClick,
    onKickConfirm,
  };
}
