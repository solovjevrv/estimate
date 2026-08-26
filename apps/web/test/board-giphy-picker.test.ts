/**
 * Тесты BoardGiphyPicker.vue (21.9): трендовые GIF по умолчанию, debounce
 * поиска, выбор GIF (emit select), пагинация «Показать ещё», недоступность
 * фичи (404 → постоянное сообщение вместо бесконечного лоадера).
 */
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GiphyGifSummary } from '@poker/shared';
import { createAppI18n } from '../src/i18n';
import { ApiError } from '../src/lib/api';

const mockApi = vi.hoisted(() => ({
  searchGiphy: vi.fn(),
  trendingGiphy: vi.fn(),
  giphyMediaUrl: vi.fn((id: string, variant: string) => `/api/giphy/media/${id}/${variant}`),
}));

vi.mock('../src/features/boards/api/giphy-api', () => mockApi);

function gif(id: string): GiphyGifSummary {
  return { id, title: `GIF ${id}`, previewWidth: 100, previewHeight: 80, width: 480, height: 384 };
}

async function mountPicker() {
  const { default: BoardGiphyPicker } =
    await import('../src/components/board/BoardGiphyPicker.vue');
  const wrapper = mount(BoardGiphyPicker, {
    global: { plugins: [createAppI18n('ru')] },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('BoardGiphyPicker', () => {
  beforeEach(() => {
    mockApi.searchGiphy.mockReset();
    mockApi.trendingGiphy.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('при монтировании показывает трендовые GIF (пустой запрос)', async () => {
    mockApi.trendingGiphy.mockResolvedValue([gif('a'), gif('b')]);
    const wrapper = await mountPicker();

    expect(mockApi.trendingGiphy).toHaveBeenCalledWith(24, 0);
    expect(wrapper.findAll('[data-testid="board-giphy-picker-item"]')).toHaveLength(2);
  });

  it('пустой результат без ошибки показывает "ничего не найдено"', async () => {
    mockApi.trendingGiphy.mockResolvedValue([]);
    const wrapper = await mountPicker();

    expect(wrapper.text()).toContain('Ничего не найдено');
  });

  it('404 от сервера показывает постоянное сообщение о недоступности', async () => {
    mockApi.trendingGiphy.mockRejectedValue(new ApiError(404, 'not_found', 'not found'));
    const wrapper = await mountPicker();

    expect(wrapper.text()).toContain('Поиск GIF временно недоступен');
  });

  it('клик по GIF эмитит select с самим объектом', async () => {
    const g = gif('abc123');
    mockApi.trendingGiphy.mockResolvedValue([g]);
    const wrapper = await mountPicker();

    await wrapper.find('[data-testid="board-giphy-picker-item"]').trigger('click');

    expect(wrapper.emitted('select')).toEqual([[g]]);
  });

  it('ввод в поиск с debounce вызывает searchGiphy с обрезанным запросом', async () => {
    vi.useFakeTimers();
    mockApi.trendingGiphy.mockResolvedValue([]);
    mockApi.searchGiphy.mockResolvedValue([gif('c')]);

    const { default: BoardGiphyPicker } =
      await import('../src/components/board/BoardGiphyPicker.vue');
    const wrapper = mount(BoardGiphyPicker, { global: { plugins: [createAppI18n('ru')] } });
    await vi.advanceTimersByTimeAsync(10);

    await wrapper.find('input').setValue('  cats  ');
    await vi.advanceTimersByTimeAsync(300);
    await wrapper.vm.$nextTick();

    expect(mockApi.searchGiphy).toHaveBeenCalledWith('cats', 24, 0);
  });

  it('«Показать ещё» догружает следующую страницу и накапливает результаты', async () => {
    mockApi.trendingGiphy.mockResolvedValueOnce(
      Array.from({ length: 24 }, (_, i) => gif(`p1-${i}`)),
    );
    const wrapper = await mountPicker();
    expect(wrapper.findAll('[data-testid="board-giphy-picker-item"]')).toHaveLength(24);

    mockApi.trendingGiphy.mockResolvedValueOnce([gif('p2-0')]);
    await wrapper.find('.board-giphy-picker-more').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await wrapper.vm.$nextTick();

    expect(mockApi.trendingGiphy).toHaveBeenLastCalledWith(24, 24);
    expect(wrapper.findAll('[data-testid="board-giphy-picker-item"]')).toHaveLength(25);
  });
});
