/**
 * Глобальные хоткеи холста доски (12.9) — Delete/Backspace, Ctrl(Cmd)+A/D/0/1,
 * Escape. Слушатель вешается на `document`, а не на конкретный элемент: сама
 * доска не имеет собственного фокуса (Vue Flow не делает холст `tabindex`-фокусируемым),
 * так что "фокус на холсте" эмулировать нечем — вместо этого единственная
 * защита от конфликта с обычным вводом текста — проверка, что фокус СЕЙЧАС не
 * внутри редактируемого поля (`isEditableTarget`): без неё Ctrl+A/Delete внутри
 * текста стикера выделяли/удаляли бы элементы доски, а не сам текст.
 *
 * Escape для отмены редактирования конкретного текстового поля (стикер/фигура/
 * подпись связи) уже обрабатывается локально в каждом компоненте через
 * `@keydown.esc.stop.prevent` — `.stop` не даёт событию всплыть досюда, так что
 * конфликта с `clearSelection` ниже нет.
 *
 * Undo/redo (12.10) — Cmd/Ctrl+Z и Cmd/Ctrl+Shift+Z, плюс Ctrl+Y как
 * привычная для Windows альтернатива повтору.
 *
 * `isEditableTarget` также считает «редактируемым» фокус внутри попапа ссылки
 * тулбара выделения (12.13, `BOARD_TEXT_TOOLBAR_SELECTOR` — общая константа с
 * `use-rich-text-editing.ts#onEditableBlur`, обе проверки обязаны совпадать).
 * Это единственный попап тулбара, куда фокус реально уходит (поле URL) —
 * остальные кнопки (Начертание/Маркер/Выравнивание/Цвет/Форма/...) либо гасят
 * `mousedown.prevent` и вовсе не уводят фокус с contenteditable, либо (Цвет/
 * Форма/Дублировать/Удалить) намеренно НЕ защищены — клик по ним посреди
 * редактирования должен обычным образом закоммитить черновик, не застревать
 * в «редактируемом» состоянии. Раньше проверка матчила весь `.board-selection-toolbar`
 * целиком — из-за этого клик «Дублировать» посреди набора текста переставал
 * коммитить (копировал старое содержимое, тихая потеря черновика), а глобальные
 * хоткеи не работали после клика по любой кнопке тулбара; сузили до одного
 * попапа, см. подробности в `use-rich-text-editing.ts`.
 */
import { onBeforeUnmount, onMounted, type Ref } from 'vue';

import { BOARD_TEXT_TOOLBAR_SELECTOR } from '../../features/boards/rich-text/board-rich-text';

export interface BoardHotkeyActions {
  canEdit: Ref<boolean>;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  resetZoom: () => void;
  fitView: () => void;
  undo: () => void;
  redo: () => void;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable) {
    return true;
  }
  return !!target.closest(BOARD_TEXT_TOOLBAR_SELECTOR);
}

export function useBoardHotkeys(actions: BoardHotkeyActions): void {
  function onKeydown(event: KeyboardEvent): void {
    if (isEditableTarget(event.target)) return;
    const meta = event.ctrlKey || event.metaKey;

    if ((event.key === 'Delete' || event.key === 'Backspace') && actions.canEdit.value) {
      event.preventDefault();
      actions.deleteSelection();
      return;
    }
    if (meta && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      actions.selectAll();
      return;
    }
    if (meta && event.key.toLowerCase() === 'd') {
      if (!actions.canEdit.value) return;
      event.preventDefault();
      actions.duplicateSelection();
      return;
    }
    if (meta && event.key.toLowerCase() === 'z') {
      if (!actions.canEdit.value) return;
      event.preventDefault();
      if (event.shiftKey) {
        actions.redo();
      } else {
        actions.undo();
      }
      return;
    }
    if (meta && event.key.toLowerCase() === 'y') {
      if (!actions.canEdit.value) return;
      event.preventDefault();
      actions.redo();
      return;
    }
    if (meta && event.key === '0') {
      event.preventDefault();
      actions.resetZoom();
      return;
    }
    if (meta && event.key === '1') {
      event.preventDefault();
      actions.fitView();
      return;
    }
    if (event.key === 'Escape') {
      actions.clearSelection();
    }
  }

  onMounted(() => document.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
}
