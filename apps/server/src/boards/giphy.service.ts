import type { GiphyGifSummary } from '@poker/shared';

import type { GiphyClient } from './giphy-client';

/** 'preview' — маленький рендишн для сетки в пикере, 'full' — для размещения на доске */
export type GiphyMediaVariant = 'preview' | 'full';
export const GIPHY_MEDIA_VARIANTS: readonly GiphyMediaVariant[] = ['preview', 'full'];

export const GIPHY_SEARCH_LIMIT_MAX = 50;

export class GiphyService {
  constructor(private readonly client: GiphyClient) {}

  search(query: string, limit: number, offset: number): Promise<GiphyGifSummary[]> {
    return this.client.search(query, limit, offset);
  }

  trending(limit: number, offset: number): Promise<GiphyGifSummary[]> {
    return this.client.trending(limit, offset);
  }

  /** Резолвит АКТУАЛЬНЫЙ URL рендишна у Giphy по (id, variant) — клиенту URL не отдаём,
   *  сервер сам скачивает и стримит байты (см. giphy.plugin.ts) */
  async resolveMediaUrl(id: string, variant: GiphyMediaVariant): Promise<string | null> {
    const gif = await this.client.getById(id);
    if (!gif) return null;
    const rendition = variant === 'preview' ? gif.images.fixed_width_small : gif.images.original;
    return rendition?.url ?? null;
  }
}
