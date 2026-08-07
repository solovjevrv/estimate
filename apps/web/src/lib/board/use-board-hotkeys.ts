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
 */
import { onBeforeUnmount, onMounted, type Ref } from 'vue';

export interface BoardHotkeyActions {
  canEdit: Ref<boolean>;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  resetZoom: () => void;
  fitView: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable;
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
