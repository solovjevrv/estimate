/** REST-слой Giphy (21.9): единственное место, знающее URL `/api/giphy/*`. */
import type { GiphyGifSummary } from '@poker/shared';

import { api } from '../../../lib/api';

export function searchGiphy(
  query: string,
  limit: number,
  offset: number,
): Promise<GiphyGifSummary[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    offset: String(offset),
  });
  return api
    .get<{ gifs: GiphyGifSummary[] }>(`/api/giphy/search?${params}`)
    .then((res) => res.gifs);
}

export function trendingGiphy(limit: number, offset: number): Promise<GiphyGifSummary[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return api
    .get<{ gifs: GiphyGifSummary[] }>(`/api/giphy/trending?${params}`)
    .then((res) => res.gifs);
}

/** 'preview' — маленький рендишн для сетки в пикере, 'full' — для рендера на доске.
 *  Сервер сам скачивает у Giphy и стримит байты — клиент никогда не обращается к
 *  Giphy напрямую (доступность для РФ-аудитории, см. PROGRESS_ARCHIVE.md). */
export function giphyMediaUrl(id: string, variant: 'preview' | 'full'): string {
  return `/api/giphy/media/${encodeURIComponent(id)}/${variant}`;
}
