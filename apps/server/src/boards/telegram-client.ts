/**
 * Тонкая обёртка над Telegram Bot API (21.6): только getStickerSet + getFile —
 * без MTProto. Никаких внешних HTTP-зависимостей (Node 24 — глобальный fetch).
 */

export interface TelegramStickerFile {
  fileId: string;
  fileUniqueId: string;
  emoji: string;
  isAnimated: boolean;
  isVideo: boolean;
  /** Размер в байтах — может отсутствовать в ответе Telegram для части файлов */
  fileSize?: number;
}

export interface TelegramStickerSet {
  name: string;
  title: string;
  stickers: TelegramStickerFile[];
}

export class TelegramApiError extends Error {}

export class TelegramClient {
  constructor(private readonly botToken: string) {}

  private apiUrl(method: string): string {
    return `https://api.telegram.org/bot${this.botToken}/${method}`;
  }

  async getStickerSet(name: string): Promise<TelegramStickerSet> {
    const res = await fetch(`${this.apiUrl('getStickerSet')}?name=${encodeURIComponent(name)}`);
    const body = (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: {
        name: string;
        title: string;
        stickers: Array<{
          file_id: string;
          file_unique_id: string;
          emoji?: string;
          is_animated: boolean;
          is_video: boolean;
          file_size?: number;
        }>;
      };
    };
    if (!body.ok || !body.result) {
      throw new TelegramApiError(body.description ?? 'Пак не найден в Telegram');
    }
    return {
      name: body.result.name,
      title: body.result.title,
      stickers: body.result.stickers.map((s) => ({
        fileId: s.file_id,
        fileUniqueId: s.file_unique_id,
        emoji: s.emoji ?? '❓',
        isAnimated: s.is_animated,
        isVideo: s.is_video,
        fileSize: s.file_size,
      })),
    };
  }

  /** Скачивает содержимое файла по file_id — сперва getFile (путь), потом сам файл */
  async downloadFile(fileId: string): Promise<Buffer> {
    const infoRes = await fetch(`${this.apiUrl('getFile')}?file_id=${encodeURIComponent(fileId)}`);
    const infoBody = (await infoRes.json()) as {
      ok: boolean;
      description?: string;
      result?: { file_path: string };
    };
    if (!infoBody.ok || !infoBody.result) {
      throw new TelegramApiError(infoBody.description ?? 'Не удалось получить файл из Telegram');
    }
    const fileRes = await fetch(
      `https://api.telegram.org/file/bot${this.botToken}/${infoBody.result.file_path}`,
    );
    if (!fileRes.ok) {
      throw new TelegramApiError(`Скачивание файла не удалось: HTTP ${fileRes.status}`);
    }
    return Buffer.from(await fileRes.arrayBuffer());
  }
}
