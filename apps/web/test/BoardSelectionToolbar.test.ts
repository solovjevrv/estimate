import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { BOARD_COLOR_PALETTE } from '@poker/shared';

import BoardSelectionToolbar from '../src/components/board/BoardSelectionToolbar.vue';
import { createAppI18n } from '../src/i18n';

/**
 * UPopover/UColorPicker приходят из `@nuxt/ui` через auto-import Vite-плагина
 * (`ui()` в vite.config.ts) — тег превращается компилятором в статический
 * импорт напрямую из исходника библиотеки, а не в `resolveComponent(name)`.
 * Из-за этого `global.stubs`/`global.components` их не подменяют — стаб
 * молча игнорируется, и рендерится настоящий компонент. Поэтому тут
 * монтируем настоящие UPopover/UColorPicker (в jsdom они рендерятся
 * корректно), реально кликаем по триггеру и по пипетке, чтобы попап открылся
 * и открылся ВЛОЖЕННЫЙ попап с пикером (18.3 — своя карточка, а не встроенный
 * в сетку свотчей виджет), а вместо симуляции drag-жеста по свотчу/треку
 * (внутренняя механика библиотеки) находим реальный инстанс UColorPicker по
 * классу `.board-color-picker` (сами вешаем его на тег в разметке) и дёргаем
 * `update:modelValue` напрямую — так тестируется наша обвязка (обработчик),
 * а не реализация Nuxt UI.
 *
 * UPopover телепортирует содержимое попапа в `document.body` — вне
 * DOM-поддерева `wrapper.element`, поэтому свотчи/пипетку внутри содержимого
 * попапа ищем через `document.querySelector(All)`, а не через `wrapper.find()`.
 * `wrapper.findComponent()` ищет по дереву компонентов, а не DOM, поэтому
 * телепорт ему не мешает.
 */
function mountToolbar(props: Record<string, unknown> = {}) {
  return mount(BoardSelectionToolbar, {
    attachTo: document.body,
    global: { plugins: [createAppI18n('ru')] },
    props: {
      left: 100,
      top: 200,
      currentColor: '#FF0000',
      currentForm: 'sticky',
      currentFontSize: 16,
      currentTextColor: '#1A1A1A',
      currentTextAlign: 'left',
      editingText: true,
      activeMarks: null,
      ...props,
    },
  });
}

async function openFillColorPopover(wrapper: ReturnType<typeof mountToolbar>) {
  await wrapper.find('[aria-label="Цвет"]').trigger('click');
  await nextTick();
}

async function openTextOptionsPopover(wrapper: ReturnType<typeof mountToolbar>) {
  await wrapper.find('.board-text-options-btn').trigger('click');
  await nextTick();
}

/** Пикер (18.3) — отдельное вложенное поле, открывается только по клику на пипетку */
async function openColorPickerWidget() {
  const pipette = document.querySelector<HTMLButtonElement>('.board-color-add-trigger')!;
  pipette.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await nextTick();
}

/** `findComponent(cssSelector)` типизирован как WrapperLike (может быть DOMWrapper) — здесь всегда компонент */
function findColorPicker(wrapper: ReturnType<typeof mountToolbar>): VueWrapper {
  return wrapper.findComponent('.board-color-picker') as unknown as VueWrapper;
}

describe('BoardSelectionToolbar — цвет через UColorPicker', () => {
  it('пикер заливки не отображается, пока не нажали на пипетку', async () => {
    const wrapper = mountToolbar();
    await openFillColorPopover(wrapper);

    expect(findColorPicker(wrapper).exists()).toBe(false);
    expect(document.querySelector('.board-color-add-trigger')).not.toBeNull();
    wrapper.unmount();
  });

  it('клик по пипетке открывает пикер заливки как отдельное поле, не закрывая popover свотчей', async () => {
    const wrapper = mountToolbar();
    await openFillColorPopover(wrapper);
    const trigger = wrapper.find('[aria-label="Цвет"]');

    await openColorPickerWidget();

    expect(findColorPicker(wrapper).exists()).toBe(true);
    expect(trigger.attributes('data-state')).toBe('open');
    // Пипетка — триггер СВОЕГО вложенного UPopover, а не просто кнопка-переключатель
    expect(document.querySelector('.board-color-add-trigger')?.getAttribute('data-state')).toBe(
      'open',
    );
    wrapper.unmount();
  });

  it('emit "colorPreview" при выборе кастомного цвета заливки', async () => {
    const wrapper = mountToolbar();
    await openFillColorPopover(wrapper);
    await openColorPickerWidget();

    const picker = findColorPicker(wrapper);
    await picker.vm.$emit('update:modelValue', '#123456');

    // Drag — своё событие "colorPreview" (18.4), не "color": родитель ведёт
    // сессию превью по зафиксированным id, а не по текущему выделению
    expect(wrapper.emitted('colorPreview')?.[0]?.[0]).toBe('#123456');
    wrapper.unmount();
  });

  it('emit "textColorPreview" при выборе кастомного цвета текста', async () => {
    const wrapper = mountToolbar();
    await openTextOptionsPopover(wrapper);
    await openColorPickerWidget();

    const picker = findColorPicker(wrapper);
    await picker.vm.$emit('update:modelValue', '#AABBCC');

    expect(wrapper.emitted('textColorPreview')?.[0]?.[0]).toBe('#AABBCC');
    wrapper.unmount();
  });

  it('не закрывает popover при выборе кастомного цвета заливки', async () => {
    const wrapper = mountToolbar();
    await openFillColorPopover(wrapper);
    await openColorPickerWidget();

    const trigger = wrapper.find('[aria-label="Цвет"]');
    const picker = findColorPicker(wrapper);
    await picker.vm.$emit('update:modelValue', '#123456');
    await nextTick();

    expect(trigger.attributes('data-state')).toBe('open');
    wrapper.unmount();
  });

  it('стандартная палитра заливки работает как прежде: emit color и закрывает popover', async () => {
    const wrapper = mountToolbar();
    await openFillColorPopover(wrapper);

    const trigger = wrapper.find('[aria-label="Цвет"]');
    const swatch = document.querySelectorAll<HTMLButtonElement>('.board-color-menu button')[0]!;
    expect(swatch.getAttribute('aria-label')).toBe(BOARD_COLOR_PALETTE[0]);

    swatch.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('color')?.[0]?.[0]).toBe(BOARD_COLOR_PALETTE[0]);
    expect(trigger.attributes('data-state')).toBe('closed');
    wrapper.unmount();
  });

  it('стандартная палитра текста работает как прежде: emit textColor', async () => {
    const wrapper = mountToolbar();
    await openTextOptionsPopover(wrapper);

    const swatch = document.querySelectorAll<HTMLButtonElement>(
      '.board-color-menu .board-selection-swatch',
    )[0]!;
    expect(swatch.getAttribute('aria-label')).toBe(BOARD_COLOR_PALETTE[0]);

    swatch.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('textColor')?.[0]?.[0]).toBe(BOARD_COLOR_PALETTE[0]);
    wrapper.unmount();
  });

  it('закрытие popover свотчей закрывает и вложенный пикер — при следующем открытии снова свотчи', async () => {
    const wrapper = mountToolbar();
    await openFillColorPopover(wrapper);
    await openColorPickerWidget();
    expect(findColorPicker(wrapper).exists()).toBe(true);

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await nextTick();

    await openFillColorPopover(wrapper);
    expect(findColorPicker(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it('не рендерит нативный <input type="color">', async () => {
    const wrapper = mountToolbar();
    await openFillColorPopover(wrapper);
    await openColorPickerWidget();

    expect(document.querySelector('input[type="color"]')).toBeNull();
    wrapper.unmount();
  });

  it('игнорирует undefined от UColorPicker — не emit пустоту', async () => {
    const wrapper = mountToolbar();
    await openFillColorPopover(wrapper);
    await openColorPickerWidget();

    const picker = findColorPicker(wrapper);
    await picker.vm.$emit('update:modelValue', undefined);

    expect(wrapper.emitted('colorPreview')).toBeFalsy();
    wrapper.unmount();
  });
});
