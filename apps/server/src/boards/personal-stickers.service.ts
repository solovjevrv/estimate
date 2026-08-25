import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import type { PersonalStickerFormat, PersonalStickerPackWithStickers } from '@poker/shared';

import { NotFoundError, ValidationError } from '../errors';
import type { ObjectStorage } from '../platform/storage';

import { TelegramApiError, type TelegramClient, type TelegramStickerFile } from './telegram-client';
import { type CreatePackInput, PersonalStickersRepository } from './personal-stickers.repository';

/** Один и тот же пользователь не импортирует паков больше этого числа */
export const MAX_PERSONAL_PACKS_PER_USER = 20;
/** Максимум стикеров в одном паке (Telegram жёстче, но на всякий случай) */
export const MAX_STICKERS_PER_PACK = 200;
/** Суммарный объём хранилища пользователя в байтах */
export const MAX_TOTAL_BYTES_PER_USER = 50 * 1024 * 1024; // 50 МБ
/** Telegram сам режет стикеры любого формата некрупным лимитом; берём с запасом */
const MAX_STICKER_FILE_BYTES = 1024 * 1024; // 1 МБ на файл (после распаковки TGS), отбрасываем крупнее

export interface ImportResult {
  pack: PersonalStickerPackWithStickers;
  /** Стикеров в исходном Telegram-паке было больше, но часть отфильтрована/не скачалась */
  skipped: number;
}

/** Формат стикера по флагам Telegram (21.7): is_video → video, is_animated (TGS) → animated, иначе static */
function formatOf(sticker: TelegramStickerFile): PersonalStickerFormat {
  if (sticker.isVideo) return 'video';
  if (sticker.isAnimated) return 'animated';
  return 'static';
}

const EXTENSION_BY_FORMAT: Record<PersonalStickerFormat, string> = {
  static: 'webp',
  animated: 'json',
  video: 'webm',
};

/** Content-Type при отдаче файла стикера — используется и сервисом (put), и роутом (отдача) */
export const CONTENT_TYPE_BY_FORMAT: Record<PersonalStickerFormat, string> = {
  static: 'image/webp',
  animated: 'application/json',
  video: 'video/webm',
};

/**
 * Ключ объекта в MinIO для личного стикера. Расширение зависит от формата
 * (21.7): статичные — webp как раньше, анимированные (TGS) — распакованный
 * из gzip JSON (Lottie), видео — webm как получено от Telegram без изменений.
 */
export function personalStickerKey(
  ownerId: string,
  packId: string,
  stickerId: string,
  format: PersonalStickerFormat = 'static',
): string {
  return `stickers/users/${ownerId}/${packId}/${stickerId}.${EXTENSION_BY_FORMAT[format]}`;
}

export class PersonalStickersService {
  constructor(
    private readonly repo: PersonalStickersRepository,
    private readonly telegram: TelegramClient,
    private readonly storage: ObjectStorage,
  ) {}

  async importFromTelegram(ownerId: string, telegramSetName: string): Promise<ImportResult> {
    // 1. Идемпотентность: активный (не удалённый) пак с таким именем у этого
    // владельца уже есть — вернуть его как есть, не дёргать Telegram и не
    // создавать дубликат. Мягко удалённый пак с тем же именем — не идемпотентность,
    // а повод переимпортировать (revive) под тем же packId, см. шаг 7
    const existing = await this.repo.findPackByOwnerAndSetName(ownerId, telegramSetName);
    if (existing && !existing.deletedAt) {
      const pack = await this.repo.getPackWithStickers(existing.id);
      return { pack: pack!, skipped: 0 };
    }

    // 2. Квота на количество паков — проверяем ДО обращения к Telegram
    const packCount = await this.repo.countPacksByOwner(ownerId);
    if (packCount >= MAX_PERSONAL_PACKS_PER_USER) {
      throw new ValidationError(`Достигнут лимит ${MAX_PERSONAL_PACKS_PER_USER} личных паков`);
    }

    // 3. getStickerSet — оборачиваем TelegramApiError в ValidationError
    let stickerSet;
    try {
      stickerSet = await this.telegram.getStickerSet(telegramSetName);
    } catch (err) {
      if (err instanceof TelegramApiError) {
        throw new ValidationError(err.message);
      }
      throw err;
    }

    const originalCount = stickerSet.stickers.length;

    // 4. Пустой пак — Telegram теоретически такое отдаёт (0 стикеров),
    // раньше это неявно ловилось фильтром "нет статических" (21.6)
    if (originalCount === 0) {
      throw new ValidationError('Пак пустой — нечего импортировать');
    }

    // 5. Обрезаем до MAX_STICKERS_PER_PACK (берём первые N) — статичные,
    // анимированные (TGS/Lottie) и видео (WebM) принимаются все (21.7)
    const truncated = stickerSet.stickers.slice(0, MAX_STICKERS_PER_PACK);

    // 6. Приблизительная проверка квоты по file_size из Telegram
    if (truncated.every((s) => s.fileSize !== undefined)) {
      const currentBytes = await this.repo.sumBytesByOwner(ownerId);
      const projectedTotal =
        currentBytes + truncated.reduce((sum, s) => sum + (s.fileSize ?? 0), 0);
      if (projectedTotal > MAX_TOTAL_BYTES_PER_USER) {
        throw new ValidationError('Превышена квота на размер персональных стикеров (50 МБ)');
      }
    }

    // 7. packId: обычный импорт — свежий randomUUID; переимпорт после удаления
    // (existing здесь — только мягко удалённый пак, см. шаг 1) — переиспользуем
    // тот же id, чтобы уже расставленные на досках стикеры под старым packId
    // снова начали резолвиться сами, без патчей самих досок
    const packId = existing?.id ?? randomUUID();

    // 8. Скачиваем и загружаем каждый стикер
    const savedStickers: CreatePackInput['stickers'] = [];
    const currentBytes = await this.repo.sumBytesByOwner(ownerId);
    let totalBytes = currentBytes;

    for (const sticker of truncated) {
      const format = formatOf(sticker);
      let buffer: Buffer;
      try {
        buffer = await this.telegram.downloadFile(sticker.fileId);
      } catch {
        // Сетевой сбой на одном файле — пропускаем, не фейлим весь импорт
        // (аналогично seed-stickers.ts: report partial failure)
        continue;
      }

      if (format === 'animated') {
        // TGS — gzip поверх Lottie-JSON; распаковываем один раз при импорте,
        // чтобы на фронте не тащить gzip-декомпрессию в браузере и отдавать
        // сразу применимый для lottie-web JSON (21.7)
        try {
          buffer = gunzipSync(buffer);
        } catch {
          // Битый/неожиданный формат TGS — пропускаем именно этот стикер
          continue;
        }
      }

      // Пропускаем файлы больше лимита, не фейлим весь импорт
      if (buffer.length > MAX_STICKER_FILE_BYTES) {
        continue;
      }

      // Досрочное прерывание, если уже превышена квота
      if (totalBytes + buffer.length > MAX_TOTAL_BYTES_PER_USER) {
        break;
      }

      const stickerId = randomUUID();
      const key = personalStickerKey(ownerId, packId, stickerId, format);
      await this.storage.put(key, buffer, CONTENT_TYPE_BY_FORMAT[format]);

      savedStickers.push({
        stickerId,
        telegramFileUniqueId: sticker.fileUniqueId,
        emoji: sticker.emoji,
        format,
        byteSize: buffer.length,
      });
      totalBytes += buffer.length;
    }

    // 9. Если не осталось ни одного успешно скачанного файла — откат
    if (savedStickers.length === 0) {
      throw new ValidationError(
        'Не удалось загрузить ни одного стикера из пака — попробуйте позже или выберите другой пак',
      );
    }

    // 10. createPackWithStickers — транзакция в репозитории
    const pack = await this.repo.createPackWithStickers({
      packId,
      ownerId,
      telegramSetName: stickerSet.name,
      title: stickerSet.title,
      stickers: savedStickers,
    });

    const skipped = originalCount - savedStickers.length;
    return { pack, skipped };
  }

  async listOwn(ownerId: string): Promise<PersonalStickerPackWithStickers[]> {
    return this.repo.listPacksByOwner(ownerId);
  }

  /** Публичное чтение метаданных — без проверки владения (см. §0.2) */
  async getPublic(packId: string): Promise<PersonalStickerPackWithStickers | null> {
    return this.repo.getPackWithStickers(packId);
  }

  /** ownerId + format стикера — для резолва ключа в storage и Content-Type при публичной отдаче файла */
  async findStickerLocation(
    packId: string,
    stickerId: string,
  ): Promise<{ ownerId: string; format: PersonalStickerFormat } | null> {
    return this.repo.findStickerLocation(packId, stickerId);
  }

  async deleteOwn(ownerId: string, packId: string): Promise<void> {
    const deleted = await this.repo.deletePack(packId, ownerId);
    if (!deleted) throw new NotFoundError('Пак не найден или вам не принадлежит');
    await Promise.all(
      deleted.stickers.map((s) =>
        this.storage.remove(personalStickerKey(ownerId, packId, s.id, s.format)),
      ),
    );
  }
}
