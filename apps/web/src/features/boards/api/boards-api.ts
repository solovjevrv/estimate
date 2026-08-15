/** REST-слой досок: единственное место, знающее URL `/api/boards`, FormData и коды ответов. */
import type { Board, BoardShareRole, BoardSnapshot, BoardSummary } from '@poker/shared';
import { BOARD_IMAGE_ALLOWED_MIME_TYPES, BOARD_IMAGE_MAX_BYTES } from '@poker/shared';
import { ApiError, api } from '../../../lib/api';

export interface BoardAsset {
  url: string;
  width: number;
  height: number;
}

export type BoardAssetUploadFailure = 'invalid_type' | 'too_large' | 'forbidden' | 'failed';

export type BoardAssetUploadResult =
  { ok: true; asset: BoardAsset } | { ok: false; reason: BoardAssetUploadFailure };

export function createBoard(title: string, teamId?: string): Promise<Board> {
  return api.post<{ board: Board }>('/api/boards', { title, teamId }).then((res) => res.board);
}

/** Личные доски без команды: активные, если archived не задан, иначе только архивные */
export function listMyBoards(archived = false): Promise<BoardSummary[]> {
  return api
    .get<{ boards: BoardSummary[] }>(`/api/boards?archived=${archived}`)
    .then((res) => res.boards);
}

export function getBoard(boardId: string): Promise<BoardSnapshot> {
  return api.get<BoardSnapshot>(`/api/boards/${encodeURIComponent(boardId)}`);
}

/** Переименовать доску — доступно автору или администратору команды. Доступно и для архивной. */
export function renameBoard(boardId: string, title: string): Promise<Board> {
  return api
    .patch<{ board: Board }>(`/api/boards/${encodeURIComponent(boardId)}`, { title })
    .then((res) => res.board);
}

/** Прячет доску из основных списков, оставляя её доступной по прямой ссылке для чтения */
export function archiveBoard(boardId: string): Promise<Board> {
  return api
    .post<{ board: Board }>(`/api/boards/${encodeURIComponent(boardId)}/archive`)
    .then((res) => res.board);
}

export function unarchiveBoard(boardId: string): Promise<Board> {
  return api
    .post<{ board: Board }>(`/api/boards/${encodeURIComponent(boardId)}/unarchive`)
    .then((res) => res.board);
}

/** Необратимо: доступно только для уже заархивированной доски */
export function deleteBoard(boardId: string): Promise<void> {
  return api.delete(`/api/boards/${encodeURIComponent(boardId)}`);
}

export function setBoardShare(boardId: string, role: BoardShareRole | null): Promise<Board> {
  return api
    .patch<{ board: Board }>(`/api/boards/${encodeURIComponent(boardId)}/share`, { role })
    .then((res) => res.board);
}

/**
 * Загружает файл картинки на доску (13.2) и возвращает её URL с размерами.
 * Результат-объединение — единственный контракт для UI: ошибку не пробрасываем,
 * чтобы холст не знал ни маршрут, ни FormData, ни коды ответов.
 */
export async function uploadBoardAsset(
  boardId: string,
  file: File,
): Promise<BoardAssetUploadResult> {
  const allowedMime: readonly string[] = BOARD_IMAGE_ALLOWED_MIME_TYPES;
  if (!allowedMime.includes(file.type)) {
    return { ok: false, reason: 'invalid_type' };
  }
  if (file.size > BOARD_IMAGE_MAX_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  const formData = new FormData();
  formData.append('file', file);
  try {
    const asset = await api.upload<BoardAsset>(
      `/api/boards/${encodeURIComponent(boardId)}/assets`,
      formData,
    );
    return { ok: true, asset };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 413) return { ok: false, reason: 'too_large' };
      if (err.status === 400) return { ok: false, reason: 'invalid_type' };
      if (err.status === 403) return { ok: false, reason: 'forbidden' };
    }
    return { ok: false, reason: 'failed' };
  }
}
