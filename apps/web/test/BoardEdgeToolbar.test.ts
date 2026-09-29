import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import {
  BOARD_COLOR_PALETTE,
  BOARD_ITEM_FONT_SIZE_MAX,
  BOARD_ITEM_FONT_SIZE_MIN,
} from '@estimate/shared';

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
      currentDash: 'solid',
      currentMarkerStart: 'arrow',
      currentMarkerEnd: 'arrow',
      currentColor: '#FF0000',
      currentLabelFontSize: 13,
      currentLabelTextAlign: 'center',
      currentLabelTextColor: '#000000',
      currentLabelBold: false,
      currentLabelItalic: false,
      currentLabelUnderline: false,
      currentLabelStrike: false,
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

async function openDashPopover(wrapper: ReturnType<typeof mountToolbar>) {
  const trigger = wrapper.find('button[aria-label="Стиль обводки"]');
  await trigger.trigger('click');
  await nextTick();
  return trigger;
}

/** aria-label пункта меню рассчитывается из board.edgeDashes.<kind> */
function dashItemAriaLabel(kind: 'solid' | 'dashed' | 'dotted'): string {
  const labels: Record<'solid' | 'dashed' | 'dotted', string> = {
    solid: 'Сплошная',
    dashed: 'Штриховая',
    dotted: 'Пунктирная',
  };
  return labels[kind];
}

describe('BoardEdgeToolbar — стиль обводки связи', () => {
  it('попап со стилями обводки открывается по клику на триггер', async () => {
    const wrapper = mountToolbar();
    expect(wrapper.find('button[aria-label="Стиль обводки"]').exists()).toBe(true);
    // в закрытом состоянии только триггерный превью-спан
    expect(document.querySelectorAll('.board-edge-dash-preview')).toHaveLength(1);
    expect(document.querySelectorAll('.board-form-menu-item')).toHaveLength(0);

    const trigger = await openDashPopover(wrapper);
    expect(trigger.attributes('data-state')).toBe('open');

    const items = document.querySelectorAll<HTMLButtonElement>('.board-form-menu-item');
    expect(items).toHaveLength(3);
    wrapper.unmount();
  });

  it('клик по пункту "solid" эмиттит dash="solid"', async () => {
    const wrapper = mountToolbar({ currentDash: 'dashed' });
    await openDashPopover(wrapper);
    const item = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.board-form-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === dashItemAriaLabel('solid'))!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('dash')?.[0]?.[0]).toBe('solid');
    wrapper.unmount();
  });

  it('клик по пункту "dashed" эмиттит dash="dashed"', async () => {
    const wrapper = mountToolbar({ currentDash: 'solid' });
    await openDashPopover(wrapper);
    const item = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.board-form-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === dashItemAriaLabel('dashed'))!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('dash')?.[0]?.[0]).toBe('dashed');
    wrapper.unmount();
  });

  it('клик по пункту "dotted" эмиттит dash="dotted"', async () => {
    const wrapper = mountToolbar({ currentDash: 'solid' });
    await openDashPopover(wrapper);
    const item = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.board-form-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === dashItemAriaLabel('dotted'))!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('dash')?.[0]?.[0]).toBe('dotted');
    wrapper.unmount();
  });

  it('пункт, соответствующий currentDash, помечен активным классом', async () => {
    const wrapper = mountToolbar({ currentDash: 'dotted' });
    await openDashPopover(wrapper);

    const items = document.querySelectorAll<HTMLButtonElement>('.board-form-menu-item');
    const dashItem = Array.from(items).find(
      (btn) => btn.getAttribute('aria-label') === dashItemAriaLabel('dotted'),
    )!;
    expect(dashItem.classList.contains('board-form-menu-item-active')).toBe(true);
    wrapper.unmount();
  });
});

async function openTextOptionsPopover(wrapper: ReturnType<typeof mountToolbar>) {
  const trigger = wrapper.find('button[aria-label="Настройки текста"]');
  await trigger.trigger('click');
  await nextTick();
  return trigger;
}

async function openLabelAlignPopover(wrapper: ReturnType<typeof mountToolbar>) {
  const trigger = wrapper.find('button[aria-label="Выравнивание"]');
  await trigger.trigger('click');
  await nextTick();
  return trigger;
}

describe('BoardEdgeToolbar — размер шрифта подписи (12.18)', () => {
  it('попап "Aa" показывает текущий размер и открывается по клику на триггер', async () => {
    const wrapper = mountToolbar({ currentLabelFontSize: 20 });
    const trigger = await openTextOptionsPopover(wrapper);
    expect(trigger.attributes('data-state')).toBe('open');
    expect(document.querySelector('.board-stepper-value')?.textContent).toBe('20');
    wrapper.unmount();
  });

  it('клик "+" эмиттит labelFontSize на FONT_SIZE_STEP больше текущего', async () => {
    const wrapper = mountToolbar({ currentLabelFontSize: 20 });
    await openTextOptionsPopover(wrapper);
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Увеличить размер шрифта"]')!
      .click();
    await nextTick();
    expect(wrapper.emitted('labelFontSize')?.[0]?.[0]).toBe(22);
    wrapper.unmount();
  });

  it('клик "-" эмиттит labelFontSize на FONT_SIZE_STEP меньше текущего', async () => {
    const wrapper = mountToolbar({ currentLabelFontSize: 20 });
    await openTextOptionsPopover(wrapper);
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Уменьшить размер шрифта"]')!
      .click();
    await nextTick();
    expect(wrapper.emitted('labelFontSize')?.[0]?.[0]).toBe(18);
    wrapper.unmount();
  });

  it('кнопка "+" отключена на верхней границе BOARD_ITEM_FONT_SIZE_MAX', async () => {
    const wrapper = mountToolbar({ currentLabelFontSize: BOARD_ITEM_FONT_SIZE_MAX });
    await openTextOptionsPopover(wrapper);
    const plus = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Увеличить размер шрифта"]',
    )!;
    expect(plus.disabled).toBe(true);
    wrapper.unmount();
  });

  it('кнопка "-" отключена на нижней границе BOARD_ITEM_FONT_SIZE_MIN', async () => {
    const wrapper = mountToolbar({ currentLabelFontSize: BOARD_ITEM_FONT_SIZE_MIN });
    await openTextOptionsPopover(wrapper);
    const minus = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Уменьшить размер шрифта"]',
    )!;
    expect(minus.disabled).toBe(true);
    wrapper.unmount();
  });

  it('клик по свотчу палитры внутри "Aa" эмиттит labelTextColor', async () => {
    const wrapper = mountToolbar();
    await openTextOptionsPopover(wrapper);
    const swatch = document.querySelectorAll<HTMLButtonElement>('.board-color-menu button')[0]!;
    swatch.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('labelTextColor')?.[0]?.[0]).toBe(BOARD_COLOR_PALETTE[0]);
    wrapper.unmount();
  });
});

describe('BoardEdgeToolbar — выравнивание текста подписи (12.18)', () => {
  it('попап выравнивания открывается по клику на триггер и содержит 3 варианта', async () => {
    const wrapper = mountToolbar();
    const trigger = await openLabelAlignPopover(wrapper);
    expect(trigger.attributes('data-state')).toBe('open');
    expect(document.querySelectorAll('.board-form-menu-item')).toHaveLength(3);
    wrapper.unmount();
  });

  it('клик по пункту "По левому краю" эмиттит labelTextAlign="left"', async () => {
    const wrapper = mountToolbar({ currentLabelTextAlign: 'center' });
    await openLabelAlignPopover(wrapper);
    const item = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.board-form-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'По левому краю')!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('labelTextAlign')?.[0]?.[0]).toBe('left');
    wrapper.unmount();
  });

  it('клик по пункту "По правому краю" эмиттит labelTextAlign="right"', async () => {
    const wrapper = mountToolbar({ currentLabelTextAlign: 'center' });
    await openLabelAlignPopover(wrapper);
    const item = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.board-form-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'По правому краю')!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('labelTextAlign')?.[0]?.[0]).toBe('right');
    wrapper.unmount();
  });

  it('пункт, соответствующий currentLabelTextAlign, помечен активным классом', async () => {
    const wrapper = mountToolbar({ currentLabelTextAlign: 'right' });
    await openLabelAlignPopover(wrapper);
    const items = document.querySelectorAll<HTMLButtonElement>('.board-form-menu-item');
    const activeItem = Array.from(items).find(
      (btn) => btn.getAttribute('aria-label') === 'По правому краю',
    )!;
    expect(activeItem.classList.contains('board-form-menu-item-active')).toBe(true);
    wrapper.unmount();
  });
});

async function openLabelFormatPopover(wrapper: ReturnType<typeof mountToolbar>) {
  const trigger = wrapper.find('button[aria-label="Начертание"]');
  await trigger.trigger('click');
  await nextTick();
  return trigger;
}

function formatItem(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.board-form-menu-item')).find(
    (btn) => btn.getAttribute('aria-label') === label,
  )!;
}

describe('BoardEdgeToolbar — начертание текста подписи (12.18, общий BoardFormatButtons.vue)', () => {
  it('попап открывается по клику на триггер и содержит 4 варианта (bold/italic/underline/strike)', async () => {
    const wrapper = mountToolbar();
    const trigger = await openLabelFormatPopover(wrapper);
    expect(trigger.attributes('data-state')).toBe('open');
    expect(document.querySelectorAll('.board-form-menu-item')).toHaveLength(4);
    wrapper.unmount();
  });

  it('клик по "Жирный" эмиттит labelBold=true, если сейчас выключено', async () => {
    const wrapper = mountToolbar({ currentLabelBold: false });
    await openLabelFormatPopover(wrapper);
    formatItem('Жирный').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('labelBold')?.[0]?.[0]).toBe(true);
    wrapper.unmount();
  });

  it('клик по "Жирный" эмиттит labelBold=false, если сейчас включено', async () => {
    const wrapper = mountToolbar({ currentLabelBold: true });
    await openLabelFormatPopover(wrapper);
    formatItem('Жирный').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('labelBold')?.[0]?.[0]).toBe(false);
    wrapper.unmount();
  });

  it('клик по "Курсив" эмиттит labelItalic=true', async () => {
    const wrapper = mountToolbar({ currentLabelItalic: false });
    await openLabelFormatPopover(wrapper);
    formatItem('Курсив').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('labelItalic')?.[0]?.[0]).toBe(true);
    wrapper.unmount();
  });

  it('клик по "Подчёркнутый" эмиттит labelUnderline=true', async () => {
    const wrapper = mountToolbar({ currentLabelUnderline: false });
    await openLabelFormatPopover(wrapper);
    formatItem('Подчёркнутый').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('labelUnderline')?.[0]?.[0]).toBe(true);
    wrapper.unmount();
  });

  it('клик по "Зачёркнутый" эмиттит labelStrike=true', async () => {
    const wrapper = mountToolbar({ currentLabelStrike: false });
    await openLabelFormatPopover(wrapper);
    formatItem('Зачёркнутый').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('labelStrike')?.[0]?.[0]).toBe(true);
    wrapper.unmount();
  });

  it('триггер помечен активным классом, если активен хотя бы один вариант', async () => {
    const wrapper = mountToolbar({ currentLabelBold: true });
    const trigger = wrapper.find('button[aria-label="Начертание"]');
    expect(trigger.classes()).toContain('board-selection-icon-btn-active');
    wrapper.unmount();
  });

  it('триггер не активен, если ни один вариант не включён', async () => {
    const wrapper = mountToolbar();
    const trigger = wrapper.find('button[aria-label="Начертание"]');
    expect(trigger.classes()).not.toContain('board-selection-icon-btn-active');
    wrapper.unmount();
  });

  it('пункт "Жирный" внутри попапа помечен активным классом, когда currentLabelBold=true', async () => {
    const wrapper = mountToolbar({ currentLabelBold: true });
    await openLabelFormatPopover(wrapper);
    expect(formatItem('Жирный').classList.contains('board-form-menu-item-active')).toBe(true);
    wrapper.unmount();
  });
});
