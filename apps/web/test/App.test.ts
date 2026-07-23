import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import App from '../src/App.vue';

describe('App', () => {
  it('рендерит заголовок и колоду Фибоначчи', () => {
    const wrapper = mount(App);

    expect(wrapper.text()).toContain('Planning Poker');
    expect(wrapper.text()).toContain('1, 2, 3, 5, 8, 13, 21');
  });
});
