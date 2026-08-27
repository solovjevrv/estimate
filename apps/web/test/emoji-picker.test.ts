import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import type { EmojiCatalogEntry } from '@poker/shared';
import EmojiPicker from '../src/components/EmojiPicker.vue';
import { createAppI18n } from '../src/i18n';

/**
 * Маленький фикстурный каталог: 2 группы (smileys-emotion, people-body),
 * одна запись со skins, остальные без них. Используется вместо реального
 * каталога — vi.mock перехватывает и динамический import('@poker/shared/emoji/catalog').
 */
const { fixtureCatalog, skinTones, recentEmoji } = vi.hoisted(() => {
  const catalog: EmojiCatalogEntry[] = [
    {
      unicode: '🔥',
      group: 'smileys-emotion',
      order: 1,
      label: 'fire',
      tagsEn: ['fire', 'hot'],
      tagsRu: ['огонь', 'горячий'],
      shortcodes: ['fire'],
    },
    {
      unicode: '😂',
      group: 'smileys-emotion',
      order: 2,
      label: 'face with tears of joy',
      tagsEn: ['joy', 'laugh', 'happy'],
      tagsRu: ['смех', 'радость'],
      shortcodes: ['joy'],
    },
    {
      unicode: '👋',
      group: 'people-body',
      order: 100,
      label: 'waving hand',
      tagsEn: ['wave', 'hello', 'hi'],
      tagsRu: ['привет', 'пока'],
      shortcodes: ['wave', 'waving_hand'],
      skins: {
        light: '👋🏻',
        'medium-light': '👋🏼',
        medium: '👋🏽',
        'medium-dark': '👋🏾',
        dark: '👋🏿',
      },
    },
  ];

  const tones = [
    { id: 'light', swatch: '#F7DECE' },
    { id: 'medium-light', swatch: '#F1C27D' },
    { id: 'medium', swatch: '#E0AC69' },
    { id: 'medium-dark', swatch: '#C68642' },
    { id: 'dark', swatch: '#8D5524' },
  ];

  return { fixtureCatalog: catalog, skinTones: tones, recentEmoji: [] as string[] };
});

vi.mock('@poker/shared/emoji/catalog', () => ({
  EMOJI_CATALOG: fixtureCatalog,
}));

vi.mock('../src/features/emoji/infrastructure/recent-emoji', () => ({
  getRecentEmoji: () => recentEmoji,
  addRecentEmoji: () => {},
}));

vi.mock('../src/features/emoji/config/skin-tone', () => ({
  getPreferredSkinTone: () => null,
  setPreferredSkinTone: () => {},
  SKIN_TONES: skinTones,
}));

async function mountPicker(props?: { initiallyCollapsed?: boolean }) {
  const wrapper = mount(EmojiPicker, {
    props,
    global: { plugins: [createAppI18n('ru')] },
  });
  // onMounted асинхронно (await import) — даём микрозадаче резолва
  // и трём nextTick на перерендер Vue
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('EmojiPicker', () => {
  it('по умолчанию (реакции) рендерит сразу все категории', async () => {
    const wrapper = await mountPicker();

    // recent пустой — секция не рендерится; обе группы каталога видны сразу
    const sections = wrapper.findAll('[data-testid="emoji-picker-section"]');
    expect(sections).toHaveLength(2);
    expect(wrapper.find('[data-testid="emoji-picker-show-all"]').exists()).toBe(false);
  });

  it('initiallyCollapsed: изначально рендерит только первую категорию', async () => {
    const wrapper = await mountPicker({ initiallyCollapsed: true });

    const sections = wrapper.findAll('[data-testid="emoji-picker-section"]');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.text()).toContain('Смайлы и эмоции');
    expect(wrapper.find('[data-testid="emoji-picker-show-all"]').exists()).toBe(true);
  });

  it('initiallyCollapsed: клик по «Показать все категории» разворачивает остальные секции', async () => {
    const wrapper = await mountPicker({ initiallyCollapsed: true });

    await wrapper.find('[data-testid="emoji-picker-show-all"]').trigger('click');
    await wrapper.vm.$nextTick();

    const sections = wrapper.findAll('[data-testid="emoji-picker-section"]');
    expect(sections).toHaveLength(2);
    expect(wrapper.find('[data-testid="emoji-picker-show-all"]').exists()).toBe(false);
  });

  it('initiallyCollapsed: клик по вкладке второй категории тоже разворачивает все секции', async () => {
    const wrapper = await mountPicker({ initiallyCollapsed: true });

    const tabs = wrapper.findAll('.emoji-picker-tab');
    await tabs[tabs.length - 1]!.trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[data-testid="emoji-picker-section"]')).toHaveLength(2);
  });

  it('ввод в поиск фильтрует по label', async () => {
    const wrapper = await mountPicker();
    const input = wrapper.find('[data-testid="emoji-picker-search"]');
    await input.setValue('fire');
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('[data-testid="emoji-picker-item"]').map((b) => b.text());
    expect(items).toContain('🔥');
    expect(items).not.toContain('😂');
  });

  it('ввод в поиск фильтрует по tagsRu', async () => {
    const wrapper = await mountPicker();
    const input = wrapper.find('[data-testid="emoji-picker-search"]');
    await input.setValue('огонь');
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('[data-testid="emoji-picker-item"]').map((b) => b.text());
    expect(items).toContain('🔥');
    expect(items).not.toContain('😂');
  });

  it('ввод в поиск фильтрует по tagsEn', async () => {
    const wrapper = await mountPicker();
    const input = wrapper.find('[data-testid="emoji-picker-search"]');
    await input.setValue('joy');
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('[data-testid="emoji-picker-item"]').map((b) => b.text());
    expect(items).toContain('😂');
    expect(items).not.toContain('🔥');
  });

  it('ввод в поиск фильтрует по shortcodes (без двоеточий)', async () => {
    const wrapper = await mountPicker();
    const input = wrapper.find('[data-testid="emoji-picker-search"]');
    await input.setValue(':wave');
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('[data-testid="emoji-picker-item"]').map((b) => b.text());
    expect(items).toContain('👋');
    expect(items).not.toContain('🔥');
  });

  it('клик по эмодзи эмитит select с ожидаемой строкой', async () => {
    const wrapper = await mountPicker();

    const fireBtn = wrapper.findAll('[data-testid="emoji-picker-item"]')[0]!;
    expect(fireBtn.text()).toBe('🔥');
    await fireBtn.trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
    expect(wrapper.emitted('select')![0]).toEqual(['🔥']);
  });

  it('выбор тона кожи меняет отображаемый глиф для entry со skins', async () => {
    const wrapper = await mountPicker();

    // Выбираем тон 'light'
    const skinBtn = wrapper.find('[data-testid="emoji-picker-skin-tone"]').findAll('button')[1]!; // [0] = default, [1] = light
    await skinBtn.trigger('click');
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('[data-testid="emoji-picker-item"]').map((b) => b.text());
    expect(items).toContain('👋🏻');
  });

  it('выбор тона кожи не влияет на entry без skins', async () => {
    const wrapper = await mountPicker();

    const skinBtn = wrapper.find('[data-testid="emoji-picker-skin-tone"]').findAll('button')[1]!; // light
    await skinBtn.trigger('click');
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('[data-testid="emoji-picker-item"]').map((b) => b.text());
    expect(items).toContain('🔥');
  });

  it('пустой результат поиска показывает noResults', async () => {
    const wrapper = await mountPicker();
    const input = wrapper.find('[data-testid="emoji-picker-search"]');
    await input.setValue('xyz-nonexistent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.emoji-picker-no-results').text()).toBe('Ничего не найдено');
  });
});
