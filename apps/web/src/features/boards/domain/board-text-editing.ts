/**
 * Мультивыбор во время редактирования текста (12.23) — чистая функция вынесена
 * из `BoardCanvas.vue`, потому что реальный триггер бага (shift-клик по
 * другому узлу, не снимающий DOM-фокус с редактируемого contenteditable из-за
 * `mousedown.preventDefault()` где-то во внутренней логике Vue Flow при
 * построении мультивыбора) не воспроизводится через Playwright `page.mouse` —
 * обычный клик в headless Chromium уже блюрит contenteditable и коммитит
 * правку через `onEditableBlur`, независимо от этой функции (проверено вручную
 * при разработке фикса). Юнит-тест на эту функцию — единственная надёжная
 * регрессия для этого сценария; e2e с реальным кликом её не ловит.
 */
export function selectionEscapedActiveEditor(
  editingItemId: string,
  selectedNodeIds: readonly string[],
): boolean {
  return selectedNodeIds.some((id) => id !== editingItemId);
}
