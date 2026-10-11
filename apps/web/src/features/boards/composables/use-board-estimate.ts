import type { BoardItem, BoardItemEstimate, EstimateRoomLink } from '@estimate/shared';
import { BOARD_ESTIMATE_MAX_ITEMS, isVotableContent } from '@estimate/shared';
import { useToast } from '@nuxt/ui/composables';
import { computed, ref, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../../../lib/api';

export interface UseBoardEstimateOptions {
  boardId: () => string;
  selectedItems: () => readonly BoardItem[];
  estimates: () => Readonly<Record<string, BoardItemEstimate>>;
  /** Заводить комнаты: право правки доски и вход в аккаунт (гостю доски комнату не завести) */
  canCreate: () => boolean;
  /** Пока идёт голосование точками или открыты его итоги — угол элемента занят точками */
  voting: { isActive: Ref<boolean>; hasResults: Ref<boolean> };
  createRooms: (boardId: string, itemIds: string[]) => Promise<EstimateRoomLink[]>;
  /** Новая вкладка — снаружи для тестов; по умолчанию `window.open` */
  openTab?: () => Window | null;
}

/** Действие для выделения: завести комнаты или открыть уже заведённую */
export type BoardEstimateAction = 'create' | 'open';

export function estimateRoomUrl(roomId: string): string {
  return `/rooms/${encodeURIComponent(roomId)}`;
}

/**
 * Оценка в покере с доски (15.6): «Оценить в покере» в тулбаре и контекстном
 * меню, бейдж оценки на элементе. Одна комната — сразу в новой вкладке (её
 * открываем синхронно в клике, иначе браузер примет её за всплывающее окно);
 * несколько — тост, комнаты открываются бейджами на элементах.
 */
export function useBoardEstimate(options: UseBoardEstimateOptions) {
  const { t } = useI18n();
  const toast = useToast();
  const pending = ref(false);
  const openTab = options.openTab ?? (() => window.open('', '_blank'));

  /** Что отправлять в покер: только стикеры — иначе null */
  const targets = computed<BoardItem[] | null>(() => {
    const selected = options.selectedItems();
    if (selected.length === 0 || selected.length > BOARD_ESTIMATE_MAX_ITEMS) return null;
    return selected.every((item) => isVotableContent(item.content)) ? [...selected] : null;
  });

  const action = computed<BoardEstimateAction | null>(() => {
    const items = targets.value;
    if (!items || options.voting.isActive.value) return null;
    const [only] = items;
    if (items.length === 1 && only && options.estimates()[only.id]) return 'open';
    return options.canCreate() ? 'create' : null;
  });

  /** Оценка на элементе — если угол не занят точками голосования */
  function estimateFor(itemId: string): BoardItemEstimate | null {
    if (options.voting.isActive.value || options.voting.hasResults.value) return null;
    return options.estimates()[itemId] ?? null;
  }

  function openRoom(roomId: string): void {
    const tab = openTab();
    if (tab) {
      tab.opener = null;
      tab.location.href = estimateRoomUrl(roomId);
    }
  }

  async function run(): Promise<void> {
    const items = targets.value;
    if (!items || pending.value) return;
    if (action.value === 'open') {
      const roomId = options.estimates()[items[0]!.id]?.roomId;
      if (roomId) openRoom(roomId);
      return;
    }
    if (action.value !== 'create') return;

    // Вкладку — до запроса, пока клик ещё «пользовательский»
    const tab = items.length === 1 ? openTab() : null;
    pending.value = true;
    try {
      const rooms = await options.createRooms(
        options.boardId(),
        items.map((item) => item.id),
      );
      if (tab) {
        const [room] = rooms;
        if (room) {
          tab.opener = null;
          tab.location.href = estimateRoomUrl(room.roomId);
        } else {
          tab.close();
        }
        return;
      }
      const created = rooms.filter((room) => room.created).length;
      toast.add({
        title: created
          ? t('board.estimate.created', { count: created })
          : t('board.estimate.alreadyExist'),
        description: t('board.estimate.openHint'),
        icon: 'i-lucide-spade',
      });
    } catch (err) {
      tab?.close();
      toast.add({
        title:
          err instanceof ApiError && err.status === 403
            ? t('board.estimate.forbidden')
            : t('board.estimate.error'),
        color: 'error',
      });
    } finally {
      pending.value = false;
    }
  }

  return { action, pending, estimateFor, openRoom, run };
}

export type BoardEstimate = ReturnType<typeof useBoardEstimate>;
