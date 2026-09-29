import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import type { EmojiCatalogEntry } from '@estimate/shared';
import EmojiPicker from '../src/components/EmojiPicker.vue';
import { createAppI18n } from '../src/i18n';

/**
 * Маленький фикстурный каталог: 2 группы (smileys-emotion, people-body),
 * одна запись со skins, остальные без них. Используется вместо реального
 * каталога — vi.mock перехватывает и динамический import('@estimate/shared/emoji/catalog').
 */
const { fixtureCatalog, skinTones, recentEmoji, preferredSkinTone } = vi.hoisted(() => {
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

  return {
    fixtureCatalog: catalog,
    skinTones: tones,
    recentEmoji: [] as string[],
    // Мутируемый объект — UI выбора тона временно скрыт (27.08.2026), но
    // ранее сохранённое предпочтение из localStorage по-прежнему применяется
    preferredSkinTone: { value: null as string | null },
  };
});

vi.mock('@estimate/shared/emoji/catalog', () => ({
  EMOJI_CATALOG: fixtureCatalog,
}));

vi.mock('../src/features/emoji/infrastructure/recent-emoji', () => ({
  getRecentEmoji: () => recentEmoji,
  addRecentEmoji: () => {},
}));

vi.mock('../src/features/emoji/config/skin-tone', () => ({
  getPreferredSkinTone: () => preferredSkinTone.value,
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
  it('по умолчанию (initiallyCollapsed не передан) рендерит сразу все категории', async () => {
    const wrapper = await mountPicker();

    // recent пустой — секция не рендерится; обе группы каталога видны сразу
    const sections = wrapper.findAll('[data-testid="emoji-picker-section"]');
    expect(sections).toHaveLength(2);
    expect(wrapper.find('[data-testid="emoji-picker-show-all"]').exists()).toBe(false);
  });

  it('initiallyCollapsed: изначально нет категорий, тона кожи и вкладок — только поиск и кнопка', async () => {
    const wrapper = await mountPicker({ initiallyCollapsed: true });

    // recent пустой — секций вообще нет, каталог полностью свёрнут
    expect(wrapper.findAll('[data-testid="emoji-picker-section"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="emoji-picker-skin-tone"]').exists()).toBe(false);
    expect(wrapper.find('.emoji-picker-tab').exists()).toBe(false);
    expect(wrapper.find('[data-testid="emoji-picker-show-all"]').exists()).toBe(true);
  });

  it('initiallyCollapsed: клик по «Показать все категории» открывает полный пикер', async () => {
    const wrapper = await mountPicker({ initiallyCollapsed: true });

    await wrapper.find('[data-testid="emoji-picker-show-all"]').trigger('click');
    await wrapper.vm.$nextTick();

    // Обе группы каталога и вкладки категорий — всё сразу (тон кожи временно скрыт)
    expect(wrapper.findAll('[data-testid="emoji-picker-section"]')).toHaveLength(2);
    expect(wrapper.findAll('.emoji-picker-tab').length).toBeGreaterThan(0);
    expect(wrapper.find('[data-testid="emoji-picker-show-all"]').exists()).toBe(false);
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

  // UI выбора тона кожи временно скрыт (27.08.2026) — но ранее сохранённое в
  // localStorage предпочтение по-прежнему молча применяется при рендере
  it('ранее сохранённый тон кожи применяется к отображаемому глифу entry со skins', async () => {
    preferredSkinTone.value = 'light';
    try {
      const wrapper = await mountPicker();
      const items = wrapper.findAll('[data-testid="emoji-picker-item"]').map((b) => b.text());
      expect(items).toContain('👋🏻');
    } finally {
      preferredSkinTone.value = null;
    }
  });

  it('сохранённый тон кожи не влияет на entry без skins', async () => {
    preferredSkinTone.value = 'light';
    try {
      const wrapper = await mountPicker();
      const items = wrapper.findAll('[data-testid="emoji-picker-item"]').map((b) => b.text());
      expect(items).toContain('🔥');
    } finally {
      preferredSkinTone.value = null;
    }
  });

  it('пустой результат поиска показывает noResults', async () => {
    const wrapper = await mountPicker();
    const input = wrapper.find('[data-testid="emoji-picker-search"]');
    await input.setValue('xyz-nonexistent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.emoji-picker-no-results').text()).toBe('Ничего не найдено');
  });
});
