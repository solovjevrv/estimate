import { describe, expect, it } from 'vitest';

import { nextEntityModalValue } from '../src/lib/entity-text-modal';

describe('nextEntityModalValue (18.8)', () => {
  it('на открытии подставляет свежий initialValue, отбрасывая текущее значение', () => {
    expect(nextEntityModalValue(true, 'Новое имя', 'Что угодно')).toBe('Новое имя');
    expect(nextEntityModalValue(true, 'Новое имя', '')).toBe('Новое имя');
  });

  it('на закрытии НЕ сбрасывает значение — модалка ещё видима во время анимации исчезновения', () => {
    expect(nextEntityModalValue(false, 'Исходное имя', 'Исходное имя')).toBe('Исходное имя');
    // Даже если пользователь успел что-то напечатать перед закрытием —
    // ничего не обнуляется, следующее открытие всё равно подставит свежий initialValue
    expect(nextEntityModalValue(false, 'Исходное имя', 'Черновик')).toBe('Черновик');
  });
});
