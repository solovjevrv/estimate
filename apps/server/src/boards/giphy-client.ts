/**
 * Тонкая обёртка над Giphy API (21.9) — search/trending/get-by-id. Никаких
 * внешних HTTP-зависимостей (Node 24 — глобальный fetch), тот же приём, что
 * и у `telegram-client.ts` (21.6).
 */
import type { GiphyGifSummary } from '@estimate/shared';

export class GiphyApiError extends Error {}

interface GiphyApiRendition {
  url: string;
  width: string;
  height: string;
}

export interface GiphyApiGif {
  id: string;
  title: string;
  images: {
    fixed_width_small: GiphyApiRendition;
    original: GiphyApiRendition;
  };
}

/** Ключ кэша getById — id GIF, значение живёт CACHE_TTL_MS, чтобы не дёргать
 *  Giphy заново на каждый показ одного и того же GIF всем зрителям доски
 *  (Giphy API квота у beta-ключа — считаные десятки запросов в час) */
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

export class GiphyClient {
  private readonly byIdCache = new Map<string, { gif: GiphyApiGif; expiresAt: number }>();

  constructor(private readonly apiKey: string) {}

  async search(query: string, limit: number, offset: number): Promise<GiphyGifSummary[]> {
    return this.fetchList('search', { q: query, limit: String(limit), offset: String(offset) });
  }

  async trending(limit: number, offset: number): Promise<GiphyGifSummary[]> {
    return this.fetchList('trending', { limit: String(limit), offset: String(offset) });
  }

  async getById(id: string): Promise<GiphyApiGif | null> {
    const cached = this.byIdCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.gif;
    }

    const url = new URL(`https://api.giphy.com/v1/gifs/${encodeURIComponent(id)}`);
    url.searchParams.set('api_key', this.apiKey);
    const res = await fetch(url);
    if (res.status === 404) return null;
    const body = (await res.json()) as { data?: GiphyApiGif; meta?: { msg: string } };
    if (!res.ok || !body.data) {
      throw new GiphyApiError(body.meta?.msg ?? `Giphy API error: HTTP ${res.status}`);
    }

    if (this.byIdCache.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = this.byIdCache.keys().next().value;
      if (oldestKey !== undefined) this.byIdCache.delete(oldestKey);
    }
    this.byIdCache.set(id, { gif: body.data, expiresAt: Date.now() + CACHE_TTL_MS });
    return body.data;
  }

  private async fetchList(
    endpoint: 'search' | 'trending',
    params: Record<string, string>,
  ): Promise<GiphyGifSummary[]> {
    const url = new URL(`https://api.giphy.com/v1/gifs/${endpoint}`);
    url.searchParams.set('api_key', this.apiKey);
    // pg-13 — разумный дефолт для рабочего инструмента команд, не открытая соцсеть
    url.searchParams.set('rating', 'pg-13');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const res = await fetch(url);
    const body = (await res.json()) as { data?: GiphyApiGif[]; meta?: { msg: string } };
    if (!res.ok || !body.data) {
      throw new GiphyApiError(body.meta?.msg ?? `Giphy API error: HTTP ${res.status}`);
    }
    return body.data.map(toSummary);
  }
}

function toSummary(gif: GiphyApiGif): GiphyGifSummary {
  const preview = gif.images.fixed_width_small;
  const full = gif.images.original;
  return {
    id: gif.id,
    title: gif.title || 'GIF',
    previewWidth: Number(preview.width) || 1,
    previewHeight: Number(preview.height) || 1,
    width: Number(full.width) || 1,
    height: Number(full.height) || 1,
  };
}
