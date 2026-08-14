import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { BOARD_COLOR_PALETTE } from '@poker/shared';

import BoardColorPickerMenu from '../src/components/board/BoardColorPickerMenu.vue';
import { createAppI18n } from '../src/i18n';
import { addRecentColor, getRecentColors } from '../src/lib/board/recent-colors';

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(BoardColorPickerMenu, {
    attachTo: document.body,
    global: { plugins: [createAppI18n('ru')] },
    props: { currentColor: '#FF0000', ...props },
  });
}

function findColorPicker(wrapper: ReturnType<typeof mountMenu>): VueWrapper {
  return wrapper.findComponent('.board-color-picker') as unknown as VueWrapper;
}

describe('BoardColorPickerMenu', () => {
  beforeEach(() => localStorage.clear());

  it('рендерит дефолтную палитру', () => {
    const wrapper = mountMenu();
    const swatches = wrapper.findAll('.board-color-menu .board-selection-swatch');
    expect(swatches).toHaveLength(BOARD_COLOR_PALETTE.length);
    wrapper.unmount();
  });

  it('emit "pick" при клике по дефолтному свотчу', async () => {
    const wrapper = mountMenu();
    await wrapper.findAll('.board-color-menu .board-selection-swatch')[0]!.trigger('click');
    expect(wrapper.emitted('pick')?.[0]?.[0]).toBe(BOARD_COLOR_PALETTE[0]);
    wrapper.unmount();
  });

  it('не рендерит секцию «Недавние», если список пуст', () => {
    const wrapper = mountMenu();
    expect(wrapper.find('.board-color-recent-swatches').exists()).toBe(false);
    wrapper.unmount();
  });

  it('рендерит секцию «Недавние» с сохранёнными цветами', async () => {
    addRecentColor('#123456');
    const wrapper = mountMenu();
    await nextTick();
    const recent = wrapper.findAll('.board-color-recent-swatches .board-selection-swatch');
    expect(recent).toHaveLength(1);
    expect(recent[0]!.attributes('aria-label')).toBe('#123456');
    wrapper.unmount();
  });

  it('emit "pick" при клике по недавнему свотчу', async () => {
    addRecentColor('#123456');
    const wrapper = mountMenu();
    await nextTick();
    await wrapper.find('.board-color-recent-swatches .board-selection-swatch').trigger('click');
    expect(wrapper.emitted('pick')?.[0]?.[0]).toBe('#123456');
    wrapper.unmount();
  });

  it('emit "preview" (не "pick") при изменении в UColorPicker — попап не закрывается', async () => {
    const wrapper = mountMenu();
    await wrapper.find('.board-color-add-trigger').trigger('click');
    await nextTick();

    findColorPicker(wrapper).vm.$emit('update:modelValue', '#ABCDEF');

    await nextTick();

    expect(wrapper.emitted('preview')?.[0]?.[0]).toBe('#ABCDEF');
    expect(wrapper.emitted('pick')).toBeFalsy();
    wrapper.unmount();
  });

  it('кнопка «Применить» задизейблена, пока пользователь не подвигал UColorPicker', async () => {
    const wrapper = mountMenu();
    await wrapper.find('.board-color-add-trigger').trigger('click');
    await nextTick();

    const applyBtn = document.querySelector('.board-color-apply-btn');
    expect(applyBtn?.hasAttribute('disabled')).toBe(true);
    wrapper.unmount();
  });

  it('промежуточные тики drag НЕ попадают в недавние — только клик «Применить»', async () => {
    const wrapper = mountMenu();
    await wrapper.find('.board-color-add-trigger').trigger('click');
    await nextTick();

    const picker = findColorPicker(wrapper);
    // Имитация "потаскали мышкой": несколько промежуточных значений подряд
    picker.vm.$emit('update:modelValue', '#111111');
    await nextTick();
    picker.vm.$emit('update:modelValue', '#222222');
    await nextTick();
    picker.vm.$emit('update:modelValue', '#333333');
    await nextTick();
    await nextTick();

    // Ничего не осело в недавних, пока не нажали «Применить»
    expect(getRecentColors()).toEqual([]);
    expect(document.querySelector('.board-color-apply-btn')?.hasAttribute('disabled')).toBe(false);

    document
      .querySelector<HTMLButtonElement>('.board-color-apply-btn')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    // В недавние попал только последний (финальный) цвет — ровно один раз
    expect(getRecentColors()).toEqual(['#333333']);
    expect(wrapper.emitted('pick')?.[0]?.[0]).toBe('#333333');
    wrapper.unmount();
  });

  it('повторный клик «Применить» без нового drag ничего не делает (кнопка снова задизейблена)', async () => {
    const wrapper = mountMenu();
    await wrapper.find('.board-color-add-trigger').trigger('click');
    await nextTick();

    findColorPicker(wrapper).vm.$emit('update:modelValue', '#123456');

    await nextTick();
    document
      .querySelector<HTMLButtonElement>('.board-color-apply-btn')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('pick')).toHaveLength(1);

    expect(document.querySelector('.board-color-apply-btn')?.hasAttribute('disabled')).toBe(true);
    wrapper.unmount();
  });

  it('игнорирует undefined от UColorPicker', async () => {
    const wrapper = mountMenu();
    await wrapper.find('.board-color-add-trigger').trigger('click');
    await nextTick();

    findColorPicker(wrapper).vm.$emit('update:modelValue', undefined);

    await nextTick();
    expect(wrapper.emitted('preview')).toBeFalsy();
    wrapper.unmount();
  });

  it('drag без «Применить» + закрытие попапа эмитит "cancel" с исходным цветом', async () => {
    const wrapper = mountMenu({ currentColor: '#FF0000' });
    await wrapper.find('.board-color-add-trigger').trigger('click');
    await nextTick();

    findColorPicker(wrapper).vm.$emit('update:modelValue', '#00FF00');

    await nextTick();
    expect(wrapper.emitted('preview')?.[0]?.[0]).toBe('#00FF00');
    expect(wrapper.emitted('cancel')).toBeFalsy();

    // Пользователь закрыл попап, ничего не подтвердив (например, кликнул мимо) —
    // это ОТДЕЛЬНОЕ от "preview" событие: родитель должен завершить сессию
    // превью (сбросить зафиксированные id объекта), а не просто перекрасить
    wrapper.unmount();

    expect(wrapper.emitted('cancel')?.[0]?.[0]).toBe('#FF0000');
    expect(wrapper.emitted('pick')).toBeFalsy();
    expect(getRecentColors()).toEqual([]);
  });

  it('drag + «Применить» + закрытие попапа НЕ эмитит "cancel"', async () => {
    const wrapper = mountMenu({ currentColor: '#FF0000' });
    await wrapper.find('.board-color-add-trigger').trigger('click');
    await nextTick();

    findColorPicker(wrapper).vm.$emit('update:modelValue', '#00FF00');

    await nextTick();
    document
      .querySelector<HTMLButtonElement>('.board-color-apply-btn')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    wrapper.unmount();

    // Коммит через «Применить» снял pending-состояние — отмены после него быть не должно
    expect(wrapper.emitted('cancel')).toBeFalsy();
    expect(getRecentColors()).toEqual(['#00FF00']);
  });

  it('drag без «Применить», затем клик по дефолтному свотчу + закрытие — не эмитит "cancel"', async () => {
    const wrapper = mountMenu({ currentColor: '#FF0000' });
    await wrapper.find('.board-color-add-trigger').trigger('click');
    await nextTick();

    findColorPicker(wrapper).vm.$emit('update:modelValue', '#00FF00');

    await nextTick();
    await wrapper.findAll('.board-color-menu .board-selection-swatch')[0]!.trigger('click');

    // "pick" — до unmount(): VTU теряет ранее записанные emit после unmount()
    expect(wrapper.emitted('pick')?.[0]?.[0]).toBe(BOARD_COLOR_PALETTE[0]);

    // Явный выбор свотча снял pending-состояние — отмены после него быть не должно
    wrapper.unmount();
    expect(wrapper.emitted('cancel')).toBeFalsy();
  });

  it('закрытие попапа без единого drag не эмитит "cancel"', () => {
    const wrapper = mountMenu({ currentColor: '#FF0000' });
    wrapper.unmount();
    expect(wrapper.emitted('cancel')).toBeFalsy();
  });
});
