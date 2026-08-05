/** Создание и управление досками: личными (без команды) и от лица команды. */
import type { Board, BoardSnapshot, BoardSummary } from '@poker/shared';
import { defineStore } from 'pinia';

import { api } from '../lib/api';

export const useBoardsStore = defineStore('boards', () => {
  async function create(title: string, teamId?: string): Promise<Board> {
    const res = await api.post<{ board: Board }>('/api/boards', { title, teamId });
    return res.board;
  }

  /** Личные доски без команды: активные, если archived не задан, иначе только архивные */
  async function listMine(archived = false): Promise<BoardSummary[]> {
    const res = await api.get<{ boards: BoardSummary[] }>(`/api/boards?archived=${archived}`);
    return res.boards;
  }

  async function get(boardId: string): Promise<BoardSnapshot> {
    return api.get<BoardSnapshot>(`/api/boards/${encodeURIComponent(boardId)}`);
  }

  /** Переименовать доску — доступно автору или администратору команды. Доступно и для архивной. */
  async function rename(boardId: string, title: string): Promise<Board> {
    const res = await api.patch<{ board: Board }>(`/api/boards/${encodeURIComponent(boardId)}`, {
      title,
    });
    return res.board;
  }

  /** Прячет доску из основных списков, оставляя её доступной по прямой ссылке для чтения */
  async function archive(boardId: string): Promise<Board> {
    const res = await api.post<{ board: Board }>(
      `/api/boards/${encodeURIComponent(boardId)}/archive`,
    );
    return res.board;
  }

  async function unarchive(boardId: string): Promise<Board> {
    const res = await api.post<{ board: Board }>(
      `/api/boards/${encodeURIComponent(boardId)}/unarchive`,
    );
    return res.board;
  }

  /** Необратимо: доступно только для уже заархивированной доски */
  async function remove(boardId: string): Promise<void> {
    await api.delete(`/api/boards/${encodeURIComponent(boardId)}`);
  }

  return { create, listMine, get, rename, archive, unarchive, remove };
});
