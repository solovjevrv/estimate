import {
  BOARD_TITLE_MAX_LENGTH,
  BOARD_TITLE_MIN_LENGTH,
  hasTeamRole,
  type Board,
  type BoardSnapshot,
  type BoardSummary,
} from '@poker/shared';

import type { Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { TeamsRepository } from '../teams';

import { BoardsRepository } from './boards.repository';

export interface CreateBoardInput {
  title: string;
  /** Без teamId (или с null) — доска личная */
  teamId?: string | null;
}

/**
 * Уровень доступа к доске. `manage` — переименование/архивация/удаление,
 * доступно только автору доски или администратору команды (по образцу
 * скрам-мастера у комнат). Право «участник тоже правит содержимое» (см.
 * таблицу техрешений в PROGRESS.md) относится к элементам доски — появится
 * вместе с их API в 12.4/12.6, сейчас редактируемых сущностей ещё нет.
 */
type BoardAccessLevel = 'view' | 'manage';

/**
 * Правила работы с досками. Права проверяются здесь, а не в роутах, по тому
 * же принципу, что и у команд/комнат: личная доска доступна только владельцу,
 * командная — по роли в команде (guest только смотрит, admin/member могут
 * заводить новые доски; переименовать/архивировать/удалить может автор или
 * администратор команды).
 */
export class BoardsService {
  constructor(
    private readonly db: Db,
    private readonly repository: BoardsRepository,
    private readonly teams: TeamsRepository,
  ) {}

  static forDatabase(db: Db): BoardsService {
    return new BoardsService(db, new BoardsRepository(db), new TeamsRepository(db));
  }

  async create(actorId: string, input: CreateBoardInput): Promise<Board> {
    const title = this.normalizeTitle(input.title);
    const teamId = input.teamId ?? null;

    if (teamId) {
      const membership = await this.teams.findMembership(teamId, actorId);
      if (!membership) {
        throw new NotFoundError('Команда не найдена');
      }
      if (!hasTeamRole(membership.role, 'member')) {
        throw new ForbiddenError('Заводить доски команды может участник или администратор');
      }
    }

    return this.repository.insertBoard(title, teamId, actorId);
  }

  async listPersonal(actorId: string, archived = false): Promise<BoardSummary[]> {
    return this.repository.listPersonalBoards(actorId, archived);
  }

  async listForTeam(actorId: string, teamId: string, archived = false): Promise<BoardSummary[]> {
    const membership = await this.teams.findMembership(teamId, actorId);
    if (!membership) {
      throw new NotFoundError('Команда не найдена');
    }
    return this.repository.listTeamBoards(teamId, archived);
  }

  async getSnapshot(actorId: string, boardId: string): Promise<BoardSnapshot> {
    const board = await this.requireBoard(boardId);
    await this.assertAccess(board, actorId, 'view');
    const [items, edges] = await Promise.all([
      this.repository.listItems(boardId),
      this.repository.listEdges(boardId),
    ]);
    return { board, items, edges };
  }

  async rename(actorId: string, boardId: string, rawTitle: string): Promise<Board> {
    const title = this.normalizeTitle(rawTitle);
    const board = await this.requireBoard(boardId);
    await this.assertAccess(board, actorId, 'manage');
    const updated = await this.repository.updateTitle(boardId, title);
    if (!updated) {
      throw new NotFoundError('Доска не найдена');
    }
    return updated;
  }

  /** Архивация: доска пропадает из основных списков, но остаётся доступна по прямой ссылке */
  async archive(actorId: string, boardId: string): Promise<Board> {
    const board = await this.requireBoard(boardId);
    await this.assertAccess(board, actorId, 'manage');
    const archived = await this.repository.archiveBoard(boardId);
    if (!archived) {
      throw new ConflictError('Доска уже в архиве');
    }
    return archived;
  }

  async unarchive(actorId: string, boardId: string): Promise<Board> {
    const board = await this.requireBoard(boardId);
    await this.assertAccess(board, actorId, 'manage');
    const restored = await this.repository.unarchiveBoard(boardId);
    if (!restored) {
      throw new ConflictError('Доска не в архиве');
    }
    return restored;
  }

  /** Настоящее удаление — необратимо, доступно только для уже заархивированной доски */
  async remove(actorId: string, boardId: string): Promise<void> {
    const board = await this.requireBoard(boardId);
    await this.assertAccess(board, actorId, 'manage');
    if (board.status !== 'archived') {
      throw new ConflictError('Сначала заархивируйте доску');
    }
    await this.repository.deleteBoard(boardId);
  }

  private async requireBoard(boardId: string): Promise<Board> {
    const board = await this.repository.findBoard(boardId);
    if (!board) {
      throw new NotFoundError('Доска не найдена');
    }
    return board;
  }

  /** Чужим и несуществующим доскам отвечаем одинаково — иначе id можно перебирать */
  private async assertAccess(
    board: Board,
    actorId: string,
    required: BoardAccessLevel,
  ): Promise<void> {
    if (!board.teamId) {
      if (board.ownerId !== actorId) {
        throw new NotFoundError('Доска не найдена');
      }
      return;
    }

    const membership = await this.teams.findMembership(board.teamId, actorId);
    if (!membership) {
      throw new NotFoundError('Доска не найдена');
    }
    if (required === 'view') {
      return;
    }
    if (!hasTeamRole(membership.role, 'admin') && board.ownerId !== actorId) {
      throw new ForbiddenError(
        'Переименовать, архивировать или удалить доску может её автор или администратор команды',
      );
    }
  }

  private normalizeTitle(raw: string): string {
    const title = raw.trim();
    if (title.length < BOARD_TITLE_MIN_LENGTH || title.length > BOARD_TITLE_MAX_LENGTH) {
      throw new ValidationError(
        `Название доски должно быть от ${BOARD_TITLE_MIN_LENGTH} до ${BOARD_TITLE_MAX_LENGTH} символов`,
      );
    }
    return title;
  }
}
