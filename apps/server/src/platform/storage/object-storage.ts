import type { Readable } from 'node:stream';

/**
 * Байтовое хранилище объектов (Epic 21) — единственный интерфейс, через который
 * сервер кладёт/читает/удаляет пользовательские и встроенные файлы (аватарки,
 * картинки досок, стикер-паки). Реализация не важна вызывающему коду: `put`
 * принимает уже готовый буфер (загрузки ограничены по размеру на входе, см.
 * `AVATAR_MAX_BYTES`/`BOARD_IMAGE_MAX_BYTES`), `get` отдаёт поток — чтобы отвечать
 * на HTTP тем же `reply.send(stream)`, каким сейчас отдаётся `createReadStream`
 * локального файла, без лишней буферизации в памяти на чтении.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** `null` — объекта с таким ключом нет */
  get(key: string): Promise<Readable | null>;
  /** Не бросает, если объекта уже нет — вызывающий код (cleanup «на лучшее усилие») сам решает, логировать ли */
  remove(key: string): Promise<void>;
  /** Бросает, если хранилище недоступно — используется в `/health` */
  ping(): Promise<void>;
}
