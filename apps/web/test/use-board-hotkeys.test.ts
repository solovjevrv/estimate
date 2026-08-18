import { describe, expect, it } from 'vitest';

import { isEditableTarget } from '../src/features/boards/composables/use-board-hotkeys';

describe('isEditableTarget', () => {
  it('true для textarea/input', () => {
    const textarea = document.createElement('textarea');
    const input = document.createElement('input');
    document.body.append(textarea, input);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(input)).toBe(true);
  });

  // jsdom не вычисляет isContentEditable из атрибута contentEditable (известное
  // ограничение) — проверяем через ту же геттер-подмену, что использует сам браузер
  it('true для contenteditable', () => {
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(editable);
    expect(isEditableTarget(editable)).toBe(true);
  });

  it('false для обычной кнопки на холсте', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    expect(isEditableTarget(button)).toBe(false);
  });

  it('false для не-HTMLElement (например, document)', () => {
    expect(isEditableTarget(document)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  /**
   * Попап ссылки тулбара (12.13) — единственное место, куда фокус реально
   * уходит (поле URL), и Reka телепортирует его содержимое в `document.body`,
   * вне поддерева `.board-selection-toolbar`. Без этого исключения уход туда
   * фокуса ошибочно читался бы как «не редактируемое поле».
   */
  it('true для содержимого попапа ссылки, телепортированного в document.body', () => {
    const teleported = document.createElement('div');
    teleported.setAttribute('data-board-text-toolbar', '');
    const input = document.createElement('input');
    teleported.appendChild(input);
    document.body.appendChild(teleported);
    expect(isEditableTarget(input)).toBe(true);
  });

  /**
   * Регрессия (12.13): раньше проверка матчила ВЕСЬ `.board-selection-toolbar`
   * — из-за этого клик «Дублировать»/«Цвет»/«Форма» посреди набора текста
   * переставал коммитить черновик (см. use-rich-text-editing.ts) и глобальные
   * хоткеи не работали, пока фокус не уходил ещё куда-то. Кнопки, которым
   * это не нужно (Цвет/Форма/Дублировать/Удалить), должны вести себя как
   * обычные элементы холста — не быть «редактируемым полем».
   */
  it('false для кнопки внутри .board-selection-toolbar без data-board-text-toolbar', () => {
    const toolbar = document.createElement('div');
    toolbar.className = 'board-selection-toolbar';
    const button = document.createElement('button');
    toolbar.appendChild(button);
    document.body.appendChild(toolbar);
    expect(isEditableTarget(button)).toBe(false);
  });
});
