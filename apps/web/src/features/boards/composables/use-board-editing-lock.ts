/**
 * Мягкая блокировка «кто-то другой сейчас редактирует этот элемент» (14.2) —
 * вынесена из `use-rich-text-editing.ts` (23.3), чтобы боковая панель свойств
 * diagram-элемента (`use-board-diagram-properties.ts`) делила ОДНУ и ту же
 * блокировку с текстовым редактированием того же itemId, а не заводила
 * параллельный, потенциально расходящийся источник правды: пользователь,
 * печатающий в панели атрибутов, обязан так же блокировать вход в
 * редактирование имени того же элемента у другого участника, и наоборот.
 */
import { computed, type Ref } from 'vue';

import { useBoardSessionStore } from '../../../stores/board-session';

export function useBoardEditingLock(itemId: string, canEdit: Ref<boolean>) {
  const boardSession = useBoardSessionStore();

  /**
   * Своя же блокировка (`participantId` совпадает с текущим участником) в
   * `lockedBy` не попадает — чтобы можно было выйти и заново войти в
   * редактирование своего же элемента без ложного «занято».
   */
  const lockedBy = computed(() => {
    const lock = boardSession.editingByItem.get(itemId);
    return lock && lock.participantId !== boardSession.participantId ? lock : null;
  });

  function setActive(active: boolean): void {
    if (!canEdit.value) return;
    void boardSession.sendAwareness('editing', { itemId, active });
  }

  return { lockedBy, setActive };
}
