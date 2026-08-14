import {
  BOARD_OPS_BATCH_MAX,
  BOARD_TITLE_MAX_LENGTH,
  BOARD_TITLE_MIN_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  hasBoardAccess,
  hasTeamRole,
  type Board,
  type BoardAccessLevel,
  type BoardCommittedOp,
  type BoardOp,
  type BoardShareRole,
  type BoardSnapshot,
  type BoardSummary,
} from '@poker/shared';

import { UsersRepository } from '../auth';
import type { Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { GuestSessions } from '../platform/realtime';
import { TeamsRepository } from '../teams';
import type { DbExecutor as TeamsDbExecutor } from '../teams/teams.repository';

import type { BoardImagesService } from './board-images.service';
import { applyBoardOp, type BoardOpState } from './board-ops';
import { BoardsRepository, type DbExecutor as BoardsDbExecutor } from './boards.repository';
import type { BoardParticipantIdentity } from './presence';

/** UUID-проверка для boardId, пришедшего из WS-или REST-payload без схемы */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateBoardInput {
  title: string;
  /** Без teamId (или с null) — доска личная */
  teamId?: string | null;
}

export interface BoardJoinRequest {
  boardId: string;
  userId: string | null;
  guestName?: string;
  guestToken?: string;
}

export interface BoardJoinResult {
  board: Board;
  access: BoardAccessLevel;
  identity: BoardParticipantIdentity;
  guestToken: string | null;
}

export interface ApplyOpsResult {
  revision: number;
  ops: BoardCommittedOp[];
}

/**
 * Правила работы с досками. Права проверяются здесь, а не в роутах/шлюзе, по
 * тому же принципу, что и у команд/комнат: личная доска доступна только
 * владельцу, командная — по роли в команде. Шаринг по ссылке (14.4) добавляет
 * второй источник доступа поверх членства в команде.
 */
export class BoardsService {
  constructor(
    private readonly db: Db,
    private readonly repository: BoardsRepository,
    private readonly teams: TeamsRepository,
    private readonly users: UsersRepository,
    private readonly guests: GuestSessions,
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
    /** Не задан — на диске файлы картинок досок не чистятся (13.2) */
    private readonly images?: BoardImagesService,
  ) {}

  static forDatabase(db: Db, guestSecret: string, images?: BoardImagesService): BoardsService {
    return new BoardsService(
      db,
      new BoardsRepository(db),
      new TeamsRepository(db),
      new UsersRepository(db),
      new GuestSessions(guestSecret, 'boardGuest'),
      (executor) => new BoardsRepository(executor),
      (executor) => new TeamsRepository(executor),
      images,
    );
  }

  /** Не даёт упасть основной операции из-за проблем с файлом на диске — чистка на лучшее усилие */
  private async cleanupImages(boardId: string, urls: readonly string[]): Promise<void> {
    if (!this.images) return;
    for (const url of urls) {
      try {
        await this.images.deleteIfOwn(boardId, url);
      } catch (err) {
        console.error('Не удалось удалить файл картинки доски', err);
      }
    }
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
  async getSnapshot(actorId: string | null, boardId: string): Promise<BoardSnapshot> {
    await this.assertViewAccess(actorId, boardId);
    const board = await this.requireBoard(boardId);
    const access =
      (await this.resolveMembershipLevel(board, actorId, this.teams)) ?? board.shareRole;
    return this.db.transaction(
      async (tx) => {
        const repo = this.createBoardsRepository(tx);
        const freshBoard = await repo.findBoard(boardId);
        if (!freshBoard) {
          throw new NotFoundError('Доска не найдена');
        }
        const [items, edges] = await Promise.all([
          repo.listItems(boardId),
          repo.listEdges(boardId),
        ]);
        return { board: freshBoard, items, edges, access: access! };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /** Доступ на чтение — используется REST-снимком и входом на доску по WS (12.4) */
  async assertViewAccess(actorId: string | null, boardId: string): Promise<Board> {
    const board = await this.requireBoard(boardId);
    await this.assertAccess(board, actorId, 'view');
    return board;
  }

  /** Доступ на редактирование — используется загрузкой файлов на доску (13.2) */
  async assertEditAccess(actorId: string | null, boardId: string): Promise<Board> {
    const board = await this.requireBoard(boardId);
    await this.assertAccess(board, actorId, 'edit');
    return board;
  }

  /**
   * Готовит вход на доску по WS (12.4): проверяет доступ, а для гостя —
   * выписывает/проверяет гостевой токен. Возвращает полную личность
   * участника, включая уровень доступа `access`.
   */
  async prepareBoardJoin(request: BoardJoinRequest): Promise<BoardJoinResult> {
    const board = await this.requireBoard(this.requireUuid(request.boardId, 'доски'));

    if (request.userId) {
      const membershipLevel = await this.resolveMembershipLevel(board, request.userId, this.teams);
      const effectiveAccess =
        membershipLevel && (!board.shareRole || hasBoardAccess(membershipLevel, board.shareRole))
          ? membershipLevel
          : (board.shareRole ?? membershipLevel);
      if (!effectiveAccess) throw new NotFoundError('Доска не найдена');
      const user = await this.users.findById(request.userId);
      if (!user) throw new ForbiddenError('Аккаунт не найден, войдите заново');
      return {
        board,
        access: effectiveAccess,
        guestToken: null,
        identity: {
          participantId: user.id,
          userId: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl,
          isGuest: false,
          access: effectiveAccess,
        },
      };
    }

    if (!board.shareRole) {
      throw new NotFoundError('Доска не найдена');
    }
    const name = this.normalizeGuestName(request.guestName ?? '');
    const session = this.guests.resume(board.id, request.guestToken);

    return {
      board,
      access: board.shareRole,
      guestToken: session.token,
      identity: {
        participantId: session.guestId,
        userId: null,
        name,
        avatarUrl: null,
        isGuest: true,
        access: board.shareRole,
      },
    };
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
    actor: { participantId: string; userId: string | null; name: string },
    boardId: string,
    ops: BoardOp[],
  ): Promise<ApplyOpsResult> {
    if (ops.length === 0) {
      throw new ValidationError('Пустой список операций');
    }
    if (ops.length > BOARD_OPS_BATCH_MAX) {
      throw new ValidationError(`Слишком много операций за раз (максимум ${BOARD_OPS_BATCH_MAX})`);
    }

    const {
      revision,
      ops: committed,
      orphanedImageUrls,
    } = await this.db.transaction(async (tx) => {
      const repo = this.createBoardsRepository(tx);
      const board = await repo.lockBoard(boardId);
      if (!board) {
        throw new NotFoundError('Доска не найдена');
      }
      await this.assertAccess(board, actor.userId, 'edit', this.createTeamsRepository(tx));
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
        applyBoardOp(state, op, boardId, actor);
      }

      // Картинки, ставшие недостижимыми этим батчем (элемент удалён или его
      // content больше не ссылается на этот файл) — файлы на диске не входят
      // в транзакцию БД, поэтому сам rm() делаем после коммита (13.2)
      const orphanedImageUrls: string[] = [];
      for (const before of items) {
        if (before.content.type !== 'image') continue;
        const after = state.items.get(before.id);
        const stillReferenced =
          after !== undefined &&
          after.content.type === 'image' &&
          after.content.url === before.content.url;
        if (!stillReferenced) {
          orphanedImageUrls.push(before.content.url);
        }
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
              const item = await repo.insertItem(boardId, actor.userId, draft);
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
      return { revision, ops: committed, orphanedImageUrls };
    });

    await this.cleanupImages(boardId, orphanedImageUrls);
    return { revision, ops: committed };
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
    const orphanedImageUrls = await this.db.transaction(async (tx) => {
      const repo = this.createBoardsRepository(tx);
      const board = await repo.lockBoard(boardId);
      if (!board) {
        throw new NotFoundError('Доска не найдена');
      }
      await this.assertAccess(board, actorId, 'manage', this.createTeamsRepository(tx));
      if (board.status !== 'archived') {
        throw new ConflictError('Сначала заархивируйте доску');
      }
      // Элементы уйдут каскадом вместе с доской — файлы картинок на диске от
      // этого каскада не зависят, чистим отдельно после коммита (13.2)
      const items = await repo.listItems(boardId);
      const imageUrls: string[] = [];
      for (const item of items) {
        if (item.content.type === 'image') {
          imageUrls.push(item.content.url);
        }
      }
      await repo.deleteBoard(boardId);
      return imageUrls;
    });
    await this.cleanupImages(boardId, orphanedImageUrls);
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
    actorId: string | null,
    required: BoardAccessLevel,
    teams: TeamsRepository = this.teams,
  ): Promise<void> {
    const membershipLevel = await this.resolveMembershipLevel(board, actorId, teams);
    if (membershipLevel && hasBoardAccess(membershipLevel, required)) return;
    if (board.shareRole && hasBoardAccess(board.shareRole, required)) return;

    if (membershipLevel === null) {
      // Чужому/анониму не подтверждаем даже факт существования доски (анти-перебор)
      throw new NotFoundError('Доска не найдена');
    }
    throw new ForbiddenError(
      'Переименовать, архивировать или удалить доску может её автор или администратор команды',
    );
  }

  /**
   * Уровень доступа по членству в команде или владению личной доской.
   * Возвращает null, если actorId === null (гость) или членства нет.
   */
  private async resolveMembershipLevel(
    board: Board,
    actorId: string | null,
    teams: TeamsRepository,
  ): Promise<BoardAccessLevel | null> {
    if (!actorId) return null;
    if (!board.teamId) {
      return board.ownerId === actorId ? 'manage' : null;
    }
    const membership = await teams.findMembership(board.teamId, actorId);
    if (!membership) return null;
    if (hasTeamRole(membership.role, 'admin') || board.ownerId === actorId) return 'manage';
    if (hasTeamRole(membership.role, 'member')) return 'edit';
    return 'view';
  }

  /** Ссылка на шаринг доступен только автору доски или администратору команды */
  async setShareRole(
    actorId: string,
    boardId: string,
    role: BoardShareRole | null,
  ): Promise<Board> {
    return this.db.transaction(async (tx) => {
      const repo = this.createBoardsRepository(tx);
      const board = await repo.lockBoard(boardId);
      if (!board) {
        throw new NotFoundError('Доска не найдена');
      }
      await this.assertAccess(board, actorId, 'manage', this.createTeamsRepository(tx));
      const updated = await repo.updateShareRole(boardId, role);
      if (!updated) {
        throw new NotFoundError('Доска не найдена');
      }
      return updated;
    });
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

  private normalizeGuestName(raw: string): string {
    const value = raw.trim();
    if (value.length === 0 || value.length > GUEST_NAME_MAX_LENGTH) {
      throw new ValidationError(`Имя: от 1 до ${GUEST_NAME_MAX_LENGTH} символов`);
    }
    return value;
  }

  /** Идентификаторы приходят по сокету без схем — проверяем формат до похода в базу */
  private requireUuid(value: string, what: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new ValidationError(`Некорректный идентификатор ${what}`);
    }
    return value;
  }
}
