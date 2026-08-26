/**
 * Типы для интеграции с Giphy (21.9): поиск GIF через Giphy API, сервер
 * проксирует целиком (клиент никогда не обращается к api.giphy.com/
 * media.giphy.com напрямую — ни доступность для РФ-аудитории, ни API-ключ
 * не должны зависеть от прямого соединения клиента с Giphy).
 */

export interface GiphyGifSummary {
  id: string;
  title: string;
  /** Размер маленького превью — для сетки в пикере */
  previewWidth: number;
  previewHeight: number;
  /** Размер полноразмерного рендишна — задаёт aspect ratio при размещении на доске */
  width: number;
  height: number;
}
