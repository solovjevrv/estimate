import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { BOARD_COLOR_PALETTE } from '@poker/shared';

import BoardColorPickerMenu from '../src/components/board/BoardColorPickerMenu.vue';
import { createAppI18n } from '../src/i18n';
import { addRecentColor } from '../src/lib/board/recent-colors';

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
    await wrapper.find('.board-color-add-btn').trigger('click');
    await nextTick();

    await findColorPicker(wrapper).vm.$emit('update:modelValue', '#ABCDEF');

    expect(wrapper.emitted('preview')?.[0]?.[0]).toBe('#ABCDEF');
    expect(wrapper.emitted('pick')).toBeFalsy();
    wrapper.unmount();
  });

  it('сохраняет цвет из UColorPicker в недавние через паузу после последнего изменения', async () => {
    vi.useFakeTimers();
    const wrapper = mountMenu();
    await wrapper.find('.board-color-add-btn').trigger('click');
    await nextTick();

    const picker = findColorPicker(wrapper);
    await picker.vm.$emit('update:modelValue', '#111111');
    await picker.vm.$emit('update:modelValue', '#222222'); // промежуточный тик — не должен осесть в недавних

    vi.advanceTimersByTime(500);
    await nextTick();

    // '#222222' — финальное значение, должно появиться среди недавних свотчей
    const recentAfter = wrapper.findAll('.board-color-recent-swatches .board-selection-swatch');
    expect(recentAfter.some((el) => el.attributes('aria-label') === '#222222')).toBe(true);
    expect(recentAfter.some((el) => el.attributes('aria-label') === '#111111')).toBe(false);
    vi.useRealTimers();
    wrapper.unmount();
  });

  it('игнорирует undefined от UColorPicker', async () => {
    const wrapper = mountMenu();
    await wrapper.find('.board-color-add-btn').trigger('click');
    await nextTick();

    await findColorPicker(wrapper).vm.$emit('update:modelValue', undefined);
    expect(wrapper.emitted('preview')).toBeFalsy();
    wrapper.unmount();
  });
});
