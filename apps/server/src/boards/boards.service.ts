import {
  BOARD_OPS_BATCH_MAX,
  BOARD_TITLE_MAX_LENGTH,
  BOARD_TITLE_MIN_LENGTH,
  hasTeamRole,
  type Board,
  type BoardCommittedOp,
  type BoardOp,
  type BoardSnapshot,
  type BoardSummary,
} from '@poker/shared';

import { UsersRepository } from '../auth';
import type { Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { TeamsRepository } from '../teams';
import type { DbExecutor as TeamsDbExecutor } from '../teams/teams.repository';

import { applyBoardOp, type BoardOpState } from './board-ops';
import { BoardsRepository, type DbExecutor as BoardsDbExecutor } from './boards.repository';

export interface CreateBoardInput {
  title: string;
  /** Без teamId (или с null) — доска личная */
  teamId?: string | null;
}

export interface BoardJoinProfile {
  board: Board;
  name: string;
  avatarUrl: string | null;
}

export interface ApplyOpsResult {
  revision: number;
  ops: BoardCommittedOp[];
}

/**
 * Уровень доступа к доске. `view` — открыть/посмотреть, `edit` — править
 * содержимое (элементы/связи, 12.4+), `manage` — переименование/архивация/
 * удаление самой доски (по образцу скрам-мастера у комнат). У личной доски
 * все три уровня — владелец. У командной: `view` — любой участник, включая
 * гостя; `edit` — участник или администратор (не гость); `manage` — автор
 * доски или администратор команды.
 */
type BoardAccessLevel = 'view' | 'edit' | 'manage';

/**
 * Правила работы с досками. Права проверяются здесь, а не в роутах/шлюзе, по
 * тому же принципу, что и у команд/комнат: личная доска доступна только
 * владельцу, командная — по роли в команде.
 */
export class BoardsService {
  constructor(
    private readonly db: Db,
    private readonly repository: BoardsRepository,
    private readonly teams: TeamsRepository,
    private readonly users: UsersRepository,
    /**
     * Репозитории для действий под транзакцией (`getSnapshot`/`applyOps`) —
     * фабрики, а не прямой `new BoardsRepository(tx)`, чтобы в юнит-тестах
     * можно было подменить их моками и не поднимать реальную БД (12.4, по
     * образцу `RoomsService`).
     */
    private readonly createBoardsRepository: (executor: BoardsDbExecutor) => BoardsRepository = (
      executor,
    ) => new BoardsRepository(executor),
    private readonly createTeamsRepository: (executor: TeamsDbExecutor) => TeamsRepository = (
      executor,
    ) => new TeamsRepository(executor),
  ) {}

  static forDatabase(db: Db): BoardsService {
    return new BoardsService(
      db,
      new BoardsRepository(db),
      new TeamsRepository(db),
      new UsersRepository(db),
    );
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

  /**
   * Снимок доски: метаданные, элементы и связи одним согласованным чтением
   * (12.4) — иначе между тремя отдельными запросами могла бы успеть пройти
   * применённая по WS операция, и клиент получил бы рваную картину (например,
   * связь на элемент, которого уже нет в присланном списке элементов).
   */
  async getSnapshot(actorId: string, boardId: string): Promise<BoardSnapshot> {
    await this.assertViewAccess(actorId, boardId);
    return this.db.transaction(
      async (tx) => {
        const repo = this.createBoardsRepository(tx);
        const board = await repo.findBoard(boardId);
        if (!board) {
          throw new NotFoundError('Доска не найдена');
        }
        const [items, edges] = await Promise.all([
          repo.listItems(boardId),
          repo.listEdges(boardId),
        ]);
        return { board, items, edges };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /** Доступ на чтение — используется REST-снимком и входом на доску по WS (12.4) */
  async assertViewAccess(actorId: string, boardId: string): Promise<Board> {
    const board = await this.requireBoard(boardId);
    await this.assertAccess(board, actorId, 'view');
    return board;
  }

  /** Готовит вход на доску по WS: проверяет доступ и подтягивает профиль для presence (12.4) */
  async prepareBoardJoin(actorId: string, boardId: string): Promise<BoardJoinProfile> {
    const board = await this.assertViewAccess(actorId, boardId);
    const user = await this.users.findById(actorId);
    if (!user) {
      throw new ForbiddenError('Аккаунт не найден, войдите заново');
    }
    return { board, name: user.name, avatarUrl: user.avatarUrl };
  }

  /**
   * Применяет батч операций над элементами/связями доски (12.4). Идёт под
   * блокировкой строки доски — конкурентные вызовы на одной доске (в том
   * числе переименование/архивация из REST, которые пишут ту же строку)
   * выполняются строго по очереди, тем же приёмом, что `withLockedRoom`
   * у комнат: `SELECT ... FOR UPDATE` блокирует любую другую транзакцию,
   * пытающуюся писать эту же строку, пока текущая не завершится.
   */
  async applyOps(
    actorId: string,
    actorName: string,
    boardId: string,
    ops: BoardOp[],
  ): Promise<ApplyOpsResult> {
    if (ops.length === 0) {
      throw new ValidationError('Пустой список операций');
    }
    if (ops.length > BOARD_OPS_BATCH_MAX) {
      throw new ValidationError(`Слишком много операций за раз (максимум ${BOARD_OPS_BATCH_MAX})`);
    }

    return this.db.transaction(async (tx) => {
      const repo = this.createBoardsRepository(tx);
      const board = await repo.lockBoard(boardId);
      if (!board) {
        throw new NotFoundError('Доска не найдена');
      }
      await this.assertAccess(board, actorId, 'edit', this.createTeamsRepository(tx));
      if (board.status !== 'active') {
        throw new ConflictError('Доска в архиве');
      }

      const [items, edges] = await Promise.all([repo.listItems(boardId), repo.listEdges(boardId)]);
      const state: BoardOpState = {
        items: new Map(items.map((item) => [item.id, item])),
        edges: new Map(edges.map((edge) => [edge.id, edge])),
      };
      // Каждая операция валидируется и применяется к состоянию по очереди —
      // так следующая операция того же батча видит эффект предыдущей
      // (например, patch сразу после create того же элемента). Первая же
      // невалидная операция бросает исключение и откатывает всю транзакцию —
      // батч применяется всё или ничего.
      for (const op of ops) {
        applyBoardOp(state, op, boardId, actorId, actorName);
      }

      // Состояние уже провалидировано целиком — теперь просто персистим и
      // собираем закоммиченные операции для рассылки. Create/patch несут
      // целиком собранную запись из БД (не патч) — другим участникам не нужно
      // ничего мержить самим, только положить запись по id (12.4). Удаление,
      // не задевшее ни одной строки в БД, не считается ошибкой: это может
      // быть связь, уже ушедшая каскадом при удалении её элемента тем же
      // батчем (applyBoardOp выше уже убрал такую связь из state).
      const committed: BoardCommittedOp[] = [];
      for (const op of ops) {
        switch (op.type) {
          case 'item.create': {
            const draft = state.items.get(op.item.id);
            if (draft) {
              const item = await repo.insertItem(boardId, actorId, draft);
              committed.push({ type: 'item.create', clientOpId: op.clientOpId, item });
            }
            break;
          }
          case 'item.patch': {
            // Пишем провалидированную запись из state, а не сырой op.patch с
            // клиента — иначе непровалидированные поля (включая boardId) ушли
            // бы в БД мимо и валидации, и проверки прав на чужую доску (12.4)
            const draft = state.items.get(op.id);
            if (draft) {
              const item = await repo.updateItem(boardId, op.id, draft);
              if (item) {
                committed.push({ type: 'item.patch', clientOpId: op.clientOpId, item });
              }
            }
            break;
          }
          case 'item.delete':
            await repo.deleteItem(boardId, op.id);
            committed.push({ type: 'item.delete', clientOpId: op.clientOpId, id: op.id });
            break;
          case 'item.react': {
            // Рассылается в форме item.patch — для остальных участников это
            // обычное обновление записи по id, реакции не отдельный протокол
            const draft = state.items.get(op.id);
            if (draft) {
              const item = await repo.updateItem(boardId, op.id, draft);
              if (item) {
                committed.push({ type: 'item.patch', clientOpId: op.clientOpId, item });
              }
            }
            break;
          }
          case 'edge.create': {
            const draft = state.edges.get(op.edge.id);
            if (draft) {
              const edge = await repo.insertEdge(boardId, draft);
              committed.push({ type: 'edge.create', clientOpId: op.clientOpId, edge });
            }
            break;
          }
          case 'edge.patch': {
            // Та же причина, что у item.patch выше — пишем провалидированное state
            const draft = state.edges.get(op.id);
            if (draft) {
              const edge = await repo.updateEdge(boardId, op.id, draft);
              if (edge) {
                committed.push({ type: 'edge.patch', clientOpId: op.clientOpId, edge });
              }
            }
            break;
          }
          case 'edge.delete':
            await repo.deleteEdge(boardId, op.id);
            committed.push({ type: 'edge.delete', clientOpId: op.clientOpId, id: op.id });
            break;
        }
      }

      const revision = await repo.bumpRevision(boardId);
      return { revision, ops: committed };
    });
  }

  /**
   * Переименование/архивация/удаление — каждое под блокировкой строки доски
   * (16.1), тем же приёмом, что `applyOps`: без неё `requireBoard` читал бы
   * права по снимку, устаревшему к моменту записи (между чтением и `UPDATE`
   * права могли смениться, или доску могли параллельно заархивировать) —
   * `SELECT ... FOR UPDATE` в `lockBoard` сериализует конкурентные вызовы на
   * одной доске, включая гонку с самим `applyOps`.
   */
  async rename(actorId: string, boardId: string, rawTitle: string): Promise<Board> {
    const title = this.normalizeTitle(rawTitle);
    return this.db.transaction(async (tx) => {
      const repo = this.createBoardsRepository(tx);
      const board = await repo.lockBoard(boardId);
      if (!board) {
        throw new NotFoundError('Доска не найдена');
      }
      await this.assertAccess(board, actorId, 'manage', this.createTeamsRepository(tx));
      const updated = await repo.updateTitle(boardId, title);
      if (!updated) {
        throw new NotFoundError('Доска не найдена');
      }
      return updated;
    });
  }

  /** Архивация: доска пропадает из основных списков, но остаётся доступна по прямой ссылке */
  async archive(actorId: string, boardId: string): Promise<Board> {
    return this.db.transaction(async (tx) => {
      const repo = this.createBoardsRepository(tx);
      const board = await repo.lockBoard(boardId);
      if (!board) {
        throw new NotFoundError('Доска не найдена');
      }
      await this.assertAccess(board, actorId, 'manage', this.createTeamsRepository(tx));
      const archived = await repo.archiveBoard(boardId);
      if (!archived) {
        throw new ConflictError('Доска уже в архиве');
      }
      return archived;
    });
  }

  async unarchive(actorId: string, boardId: string): Promise<Board> {
    return this.db.transaction(async (tx) => {
      const repo = this.createBoardsRepository(tx);
      const board = await repo.lockBoard(boardId);
      if (!board) {
        throw new NotFoundError('Доска не найдена');
      }
      await this.assertAccess(board, actorId, 'manage', this.createTeamsRepository(tx));
      const restored = await repo.unarchiveBoard(boardId);
      if (!restored) {
        throw new ConflictError('Доска не в архиве');
      }
      return restored;
    });
  }

  /** Настоящее удаление — необратимо, доступно только для уже заархивированной доски */
  async remove(actorId: string, boardId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const repo = this.createBoardsRepository(tx);
      const board = await repo.lockBoard(boardId);
      if (!board) {
        throw new NotFoundError('Доска не найдена');
      }
      await this.assertAccess(board, actorId, 'manage', this.createTeamsRepository(tx));
      if (board.status !== 'archived') {
        throw new ConflictError('Сначала заархивируйте доску');
      }
      await repo.deleteBoard(boardId);
    });
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
    teams: TeamsRepository = this.teams,
  ): Promise<void> {
    if (!board.teamId) {
      if (board.ownerId !== actorId) {
        throw new NotFoundError('Доска не найдена');
      }
      return;
    }

    const membership = await teams.findMembership(board.teamId, actorId);
    if (!membership) {
      throw new NotFoundError('Доска не найдена');
    }
    if (required === 'view') {
      return;
    }
    if (required === 'edit') {
      if (!hasTeamRole(membership.role, 'member')) {
        throw new ForbiddenError(
          'Править содержимое доски может участник или администратор команды',
        );
      }
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
