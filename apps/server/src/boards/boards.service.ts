import {
  BOARD_OPS_BATCH_MAX,
  BOARD_TITLE_MAX_LENGTH,
  BOARD_TITLE_MIN_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  isTextLengthInRange,
  isValidUuid,
  trimText,
  type Board,
  type BoardAccessLevel,
  type BoardCommittedOp,
  type BoardOp,
  type BoardShareRole,
  type BoardSnapshot,
  type BoardSummary,
} from '@estimate/shared';
import type { FastifyBaseLogger } from 'fastify';

import { TeamAccess } from '../access';
import { UsersRepository } from '../auth';
import type { DbExecutor } from '../common/db-executor';
import type { Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { GuestSessions } from '../platform/realtime';

import type { BoardImagesService } from './board-images.service';
import { applyBoardOp, type BoardOpState } from './board-ops';
import { persistBoardOps } from './board-ops.persistence';
import {
  hasRequiredBoardAccess,
  resolveBoardAccess,
  resolveMembershipBoardAccess,
} from './boards.policy';
import { BoardsRepository, type DbExecutor as BoardsDbExecutor } from './boards.repository';
import type { BoardParticipantIdentity } from './presence';

type BoardsLogger = Pick<FastifyBaseLogger, 'warn'>;

/** Без логгера сервис остаётся пригодным для изолированных unit-тестов. */
const NOOP_LOGGER: BoardsLogger = { warn: () => undefined };

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
    private readonly teams: TeamAccess,
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
    private readonly createTeamAccess: (executor: DbExecutor) => TeamAccess = (executor) =>
      TeamAccess.forExecutor(executor),
    /** Не задан — на диске файлы картинок досок не чистятся (13.2) */
    private readonly images?: BoardImagesService,
    private readonly log: BoardsLogger = NOOP_LOGGER,
  ) {}

  static forDatabase(
    db: Db,
    guestSecret: string,
    images?: BoardImagesService,
    log: BoardsLogger = NOOP_LOGGER,
  ): BoardsService {
    return new BoardsService(
      db,
      new BoardsRepository(db),
      TeamAccess.forExecutor(db),
      new UsersRepository(db),
      new GuestSessions(guestSecret, 'boardGuest'),
      (executor) => new BoardsRepository(executor),
      (executor) => TeamAccess.forExecutor(executor),
      images,
      log,
    );
  }

  /** Не даёт упасть основной операции из-за проблем с файлом на диске — чистка на лучшее усилие */
  private async cleanupImages(boardId: string, urls: readonly string[]): Promise<void> {
    if (!this.images) return;
    for (const url of urls) {
      try {
        await this.images.deleteIfOwn(boardId, url);
      } catch (err) {
        this.log.warn({ err, boardId, url }, 'Не удалось удалить файл картинки доски');
      }
    }
  }

  async create(actorId: string, input: CreateBoardInput): Promise<Board> {
    const title = this.normalizeTitle(input.title);
    const teamId = input.teamId ?? null;

    if (teamId) {
      await this.teams.require(
        teamId,
        actorId,
        'member',
        'Заводить доски команды может участник или администратор',
      );
    }

    return this.repository.insertBoard(title, teamId, actorId);
  }

  async listPersonal(actorId: string, archived = false): Promise<BoardSummary[]> {
    return this.repository.listPersonalBoards(actorId, archived);
  }

  async listForTeam(actorId: string, teamId: string, archived = false): Promise<BoardSummary[]> {
    // Доски команды видит любой её участник, включая гостя — отдельного права нет
    await this.teams.require(teamId, actorId, 'guest');
    return this.repository.listTeamBoards(teamId, archived);
  }

  /**
   * Снимок доски: метаданные, элементы и связи одним согласованным чтением
   * (12.4) — иначе между тремя отдельными запросами могла бы успеть пройти
   * применённая по WS операция, и клиент получил бы рваную картину (например,
   * связь на элемент, которого уже нет в присланном списке элементов).
   */
  async getSnapshot(actorId: string | null, boardId: string): Promise<BoardSnapshot> {
    return this.db.transaction(
      async (tx) => {
        const repo = this.createBoardsRepository(tx);
        const board = await repo.findBoard(boardId);
        if (!board) {
          throw new NotFoundError('Доска не найдена');
        }
        // Проверяем право по тому же repeatable-read снимку, что и содержимое
        // доски: нет предварительных чтений и нет access! из-за разрыва типов.
        const access = await this.assertAccess(board, actorId, 'view', this.createTeamAccess(tx));
        const [items, edges] = await Promise.all([
          repo.listItems(boardId),
          repo.listEdges(boardId),
        ]);
        return { board, items, edges, access };
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
   * Транзиционная проверка владения для legacy-fallback чтения картинок (21.5).
   * Легаси-каталог плоский (без boardId в пути) — без этой проверки
   * GET .../assets/:filename отдавал бы любой файл с валидным именем
   * независимо от того, какой доске он реально принадлежит (найденная при
   * ревью 21.5 межбордовая утечка, существовавшая с 13.2). Убрать вместе с
   * legacy-fallback после подтверждённой миграции.
   */
  async ownsImage(boardId: string, filename: string): Promise<boolean> {
    const items = await this.repository.listItems(boardId);
    return items.some(
      (item) => item.content.type === 'image' && item.content.url.endsWith(`/${filename}`),
    );
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
      const effectiveAccess = resolveBoardAccess(membershipLevel, board.shareRole);
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
      await this.assertAccess(board, actor.userId, 'edit', this.createTeamAccess(tx));
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

      const committed = await persistBoardOps(
        { repository: repo, boardId, actorUserId: actor.userId, state },
        ops,
      );

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
      await this.assertAccess(board, actorId, 'manage', this.createTeamAccess(tx));
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
      await this.assertAccess(board, actorId, 'manage', this.createTeamAccess(tx));
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
      await this.assertAccess(board, actorId, 'manage', this.createTeamAccess(tx));
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
      await this.assertAccess(board, actorId, 'manage', this.createTeamAccess(tx));
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
    teams: TeamAccess = this.teams,
  ): Promise<BoardAccessLevel> {
    const membershipLevel = await this.resolveMembershipLevel(board, actorId, teams);
    const effectiveAccess = resolveBoardAccess(membershipLevel, board.shareRole);
    if (hasRequiredBoardAccess(membershipLevel, board.shareRole, required) && effectiveAccess) {
      return effectiveAccess;
    }

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
    teams: TeamAccess,
  ): Promise<BoardAccessLevel | null> {
    const teamRole =
      board.teamId && actorId
        ? ((await teams.membershipOf(board.teamId, actorId))?.role ?? null)
        : null;
    return resolveMembershipBoardAccess(board, actorId, teamRole);
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
      await this.assertAccess(board, actorId, 'manage', this.createTeamAccess(tx));
      const updated = await repo.updateShareRole(boardId, role);
      if (!updated) {
        throw new NotFoundError('Доска не найдена');
      }
      return updated;
    });
  }

  private normalizeTitle(raw: string): string {
    const title = trimText(raw);
    if (!isTextLengthInRange(title, { min: BOARD_TITLE_MIN_LENGTH, max: BOARD_TITLE_MAX_LENGTH })) {
      throw new ValidationError(
        `Название доски должно быть от ${BOARD_TITLE_MIN_LENGTH} до ${BOARD_TITLE_MAX_LENGTH} символов`,
      );
    }
    return title;
  }

  private normalizeGuestName(raw: string): string {
    const value = trimText(raw);
    if (!isTextLengthInRange(value, { min: 1, max: GUEST_NAME_MAX_LENGTH })) {
      throw new ValidationError(`Имя: от 1 до ${GUEST_NAME_MAX_LENGTH} символов`);
    }
    return value;
  }

  /** Идентификаторы приходят по сокету без схем — проверяем формат до похода в базу */
  private requireUuid(value: string, what: string): string {
    if (typeof value !== 'string' || !isValidUuid(value)) {
      throw new ValidationError(`Некорректный идентификатор ${what}`);
    }
    return value;
  }
}
