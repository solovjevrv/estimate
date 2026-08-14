import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { BOARD_COLOR_PALETTE } from '@poker/shared';

import BoardEdgeToolbar from '../src/components/board/BoardEdgeToolbar.vue';
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
  return mount(BoardEdgeToolbar, {
    attachTo: document.body,
    global: { plugins: [createAppI18n('ru')] },
    props: {
      left: 100,
      top: 200,
      currentLine: 'straight',
      currentMarkerStart: 'arrow',
      currentMarkerEnd: 'arrow',
      currentColor: '#FF0000',
      ...props,
    },
  });
}

async function openColorPopover(wrapper: ReturnType<typeof mountToolbar>) {
  await wrapper.find('.board-selection-swatch').trigger('click');
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

describe('BoardEdgeToolbar — цвет стрелки через UColorPicker', () => {
  it('пикер не отображается, пока не нажали на пипетку', async () => {
    const wrapper = mountToolbar();
    await openColorPopover(wrapper);

    expect(findColorPicker(wrapper).exists()).toBe(false);
    expect(document.querySelector('.board-color-add-trigger')).not.toBeNull();
    wrapper.unmount();
  });

  it('клик по пипетке открывает пикер как отдельное поле, не закрывая popover свотчей', async () => {
    const wrapper = mountToolbar();
    await openColorPopover(wrapper);
    const trigger = wrapper.find('.board-selection-swatch');

    await openColorPickerWidget();

    expect(findColorPicker(wrapper).exists()).toBe(true);
    expect(trigger.attributes('data-state')).toBe('open');
    expect(document.querySelector('.board-color-add-trigger')?.getAttribute('data-state')).toBe(
      'open',
    );
    wrapper.unmount();
  });

  it('emit "colorPreview" при выборе кастомного цвета в пикере', async () => {
    const wrapper = mountToolbar();
    await openColorPopover(wrapper);
    await openColorPickerWidget();

    const picker = findColorPicker(wrapper);
    picker.vm.$emit('update:modelValue', '#123456');
    await nextTick();

    // Drag — своё событие "colorPreview" (18.4), не "color": родитель ведёт
    // сессию превью по зафиксированным id, а не по текущему выделению
    expect(wrapper.emitted('colorPreview')?.[0]?.[0]).toBe('#123456');
    wrapper.unmount();
  });

  it('не закрывает popover при выборе кастомного цвета', async () => {
    const wrapper = mountToolbar();
    await openColorPopover(wrapper);
    await openColorPickerWidget();

    const trigger = wrapper.find('.board-selection-swatch');
    const picker = findColorPicker(wrapper);
    picker.vm.$emit('update:modelValue', '#123456');
    await nextTick();
    await nextTick();

    expect(trigger.attributes('data-state')).toBe('open');
    wrapper.unmount();
  });

  it('стандартная палитра работает как прежде: emit color и закрывает popover', async () => {
    const wrapper = mountToolbar();
    await openColorPopover(wrapper);

    const trigger = wrapper.find('.board-selection-swatch');
    const swatch = document.querySelectorAll<HTMLButtonElement>('.board-color-menu button')[0]!;
    expect(swatch.getAttribute('aria-label')).toBe(BOARD_COLOR_PALETTE[0]);

    swatch.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('color')?.[0]?.[0]).toBe(BOARD_COLOR_PALETTE[0]);
    expect(trigger.attributes('data-state')).toBe('closed');
    wrapper.unmount();
  });

  it('закрытие popover свотчей закрывает и вложенный пикер — при следующем открытии снова свотчи', async () => {
    const wrapper = mountToolbar();
    await openColorPopover(wrapper);
    await openColorPickerWidget();
    expect(findColorPicker(wrapper).exists()).toBe(true);

    // Клик мимо закрывает popover (pointerDownOutside у Reka)
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await nextTick();

    await openColorPopover(wrapper);
    expect(findColorPicker(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it('не рендерит нативный <input type="color">', async () => {
    const wrapper = mountToolbar();
    await openColorPopover(wrapper);
    await openColorPickerWidget();

    expect(document.querySelector('input[type="color"]')).toBeNull();
    wrapper.unmount();
  });

  it('игнорирует undefined от UColorPicker — не emit пустоту', async () => {
    const wrapper = mountToolbar();
    await openColorPopover(wrapper);
    await openColorPickerWidget();

    const picker = findColorPicker(wrapper);
    picker.vm.$emit('update:modelValue', undefined);
    await nextTick();

    expect(wrapper.emitted('colorPreview')).toBeFalsy();
    wrapper.unmount();
  });
});
