/**
 * Тесты GiphyClient (21.9): маппинг ответа Giphy API в GiphyGifSummary,
 * кэш getById (не дёргает Giphy повторно в пределах TTL — квота у ключа
 * ограничена), обработка ошибок/404. fetch подменяется через vi.stubGlobal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GiphyApiError, GiphyClient } from '../src/boards/giphy-client';

function giphyApiGif(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: 'Funny cat',
    images: {
      fixed_width_small: {
        url: `https://media.giphy.com/${id}/small.gif`,
        width: '100',
        height: '80',
      },
      original: { url: `https://media.giphy.com/${id}/original.gif`, width: '480', height: '384' },
    },
    ...overrides,
  };
}

describe('GiphyClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('search маппит ответ Giphy в GiphyGifSummary', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [giphyApiGif('abc123')] }),
    });
    const client = new GiphyClient('test-key');

    const result = await client.search('cats', 24, 0);

    expect(result).toEqual([
      {
        id: 'abc123',
        title: 'Funny cat',
        previewWidth: 100,
        previewHeight: 80,
        width: 480,
        height: 384,
      },
    ]);
    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.pathname).toBe('/v1/gifs/search');
    expect(calledUrl.searchParams.get('api_key')).toBe('test-key');
    expect(calledUrl.searchParams.get('q')).toBe('cats');
  });

  it('trending бьёт в /v1/gifs/trending без q', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    const client = new GiphyClient('test-key');

    await client.trending(24, 0);

    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.pathname).toBe('/v1/gifs/trending');
  });

  it('title по умолчанию "GIF", если Giphy прислал пустую строку', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [giphyApiGif('abc123', { title: '' })] }),
    });
    const client = new GiphyClient('test-key');

    const [gif] = await client.search('cats', 24, 0);
    expect(gif?.title).toBe('GIF');
  });

  it('бросает GiphyApiError при неуспешном ответе', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ meta: { msg: 'Invalid authentication credentials' } }),
    });
    const client = new GiphyClient('bad-key');

    await expect(client.search('cats', 24, 0)).rejects.toThrow(GiphyApiError);
    await expect(client.search('cats', 24, 0)).rejects.toThrow(
      'Invalid authentication credentials',
    );
  });

  it('getById возвращает null на 404, не бросает', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const client = new GiphyClient('test-key');

    await expect(client.getById('missing')).resolves.toBeNull();
  });

  it('getById кэширует результат — второй вызов не бьёт в сеть повторно', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: giphyApiGif('abc123') }),
    });
    const client = new GiphyClient('test-key');

    const first = await client.getById('abc123');
    const second = await client.getById('abc123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });
});
