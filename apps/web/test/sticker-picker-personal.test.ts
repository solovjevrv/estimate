/**
 * Тесты BoardStickerPicker.vue — секция «Мои паки» (21.6):
 * плейсхолдер с кнопкой импорта, рендер паков, открытие модалки импорта.
 *
 * TelegramStickerImportModal стабится простым stub-ом: в jsdom UModal не
 * рендерит контент, так что проверяем, что пикер правильно управляет modelValue
 * и реагирует на событие imported.
 */
import { randomUUID } from 'node:crypto';

import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';

import type { PersonalStickerPackSummary } from '@estimate/shared';
import { createAppI18n } from '../src/i18n';

const mockApi = vi.hoisted(() => ({
  listMyStickerPacks: vi.fn(),
  importStickerPack: vi.fn(),
}));

vi.mock('../src/features/boards/api/personal-stickers-api', () => mockApi);

const PACK_WITH_STICKERS: PersonalStickerPackSummary = {
  id: randomUUID(),
  title: 'Full Pack',
  telegramSetName: 'fullpack',
  stickers: [
    { id: 's1', emoji: '😀', format: 'static' },
    { id: 's2', emoji: '🎉', format: 'static' },
  ],
};

const TelegramStickerImportModalStub = {
  name: 'TelegramStickerImportModal',
  props: ['modelValue', 'telegramSetName'],
  emits: ['update:modelValue', 'imported'],
  template: '<div v-if="modelValue" data-testid="import-modal">modal</div>',
};

async function mountPicker() {
  const { default: BoardStickerPicker } =
    await import('../src/components/board/BoardStickerPicker.vue');
  const pinia = createPinia();
  const wrapper = mount(BoardStickerPicker, {
    global: {
      plugins: [pinia, createAppI18n('ru')],
      stubs: { TelegramStickerImportModal: TelegramStickerImportModalStub },
    },
  });
  // onMounted асинхронно (store.load) — даём микрозадаче резолва
  await new Promise((resolve) => setTimeout(resolve, 10));
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('BoardStickerPicker — personal packs', () => {
  it('отображает плейсхолдер с кнопкой импорта, когда паков нет', async () => {
    mockApi.listMyStickerPacks.mockResolvedValue([]);
    const wrapper = await mountPicker();

    expect(wrapper.text()).toContain('Мои паки');
    expect(wrapper.text()).toContain('Импортированных паков пока нет');
    const importBtn = wrapper.find('button.board-sticker-picker-import-btn');
    expect(importBtn.exists()).toBe(true);
  });

  it('рендерит секцию «Мои паки» с названиями и сеткой стикеров', async () => {
    mockApi.listMyStickerPacks.mockResolvedValue([PACK_WITH_STICKERS]);
    const wrapper = await mountPicker();

    expect(wrapper.text()).toContain('Мои паки');
    expect(wrapper.text()).toContain('Full Pack');
    const items = wrapper.findAll('[data-testid="board-sticker-picker-item"]');
    // Минимум 2 стикера из личного пака (+ built-in стикеры тоже есть)
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it('открывает модалку импорта по клику на кнопку в плейсхолдере', async () => {
    mockApi.listMyStickerPacks.mockResolvedValue([]);
    const wrapper = await mountPicker();

    const importBtn = wrapper.find('button.board-sticker-picker-import-btn');
    await importBtn.trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="import-modal"]').exists()).toBe(true);
  });

  it('открывает модалку импорта по клику на иконку + в табах', async () => {
    mockApi.listMyStickerPacks.mockResolvedValue([]);
    const wrapper = await mountPicker();

    const tabImportBtn = wrapper.find('[aria-label="Импорт из Telegram"]');
    expect(tabImportBtn.exists()).toBe(true);
    await tabImportBtn.trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="import-modal"]').exists()).toBe(true);
  });

  it('при закрытии модалки (update:modelValue:false) плейсхолдер исчезает', async () => {
    mockApi.listMyStickerPacks.mockResolvedValue([]);

    const wrapper = await mountPicker();

    // Открываем модалку
    const tabImportBtn = wrapper.find('[aria-label="Импорт из Telegram"]');
    await tabImportBtn.trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="import-modal"]').exists()).toBe(true);

    // Симулируем закрытие модалки — stub эмитит update:modelValue(false)
    const modal = wrapper.findComponent(TelegramStickerImportModalStub);
    await modal.vm.$emit('update:modelValue', false);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="import-modal"]').exists()).toBe(false);
  });
});
