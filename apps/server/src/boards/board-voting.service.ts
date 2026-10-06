import {
  BOARD_VOTING_MAX_SCOPE_ITEMS,
  effectiveMaxPerItem,
  isValidVotingLimits,
  isVotableContent,
  type Board,
  type BoardVotePayload,
  type BoardVotingState,
  type BoardVotingSummary,
  type StartBoardVotingPayload,
} from '@estimate/shared';

import type { Db } from '../db';
import { isUniqueViolation } from '../db/errors';
import { ConflictError, NotFoundError, ValidationError } from '../errors';

import { votingStateFor, type BoardVotingSnapshot } from './board-voting-state';
import { BoardVotingRepository } from './board-voting.repository';
import type { DbExecutor } from '../common/db-executor';

/** Живые проверки доступа — их делает `BoardsService`, голосование их только вызывает */
export interface BoardVotingAccess {
  /** `edit` и доска не в архиве — запуск/завершение/отмена/скрытие итогов */
  assertActiveEditAccess(actorId: string | null, boardId: string): Promise<void>;
  /** Хотя бы `view` — голосовать может любой на доске (решение 02.10.2026) */
  assertViewAccess(actorId: string | null, boardId: string): Promise<Board>;
}

export interface BoardVoter {
  participantId: string;
  userId: string | null;
  name: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Голосование точками (15.2). Права — по живому состоянию БД на каждое
 * действие, как у `applyOps`. Голоса одного голосования применяются под
 * блокировкой его строки: два клика подряд не превысят лимиты.
 */
export class BoardVotingService {
  constructor(
    private readonly db: Db,
    private readonly access: BoardVotingAccess,
    private readonly createRepository: (executor: DbExecutor) => BoardVotingRepository = (
      executor,
    ) => new BoardVotingRepository(executor),
  ) {}

  /** Текущее голосование доски со всеми голосами; null — голосования нет */
  async loadSnapshot(boardId: string): Promise<BoardVotingSnapshot | null> {
    const repo = this.createRepository(this.db);
    const voting = await repo.findCurrent(boardId);
    if (!voting) return null;
    return { voting, votes: await repo.listVotes(voting.id) };
  }

  async start(
    actor: BoardVoter,
    boardId: string,
    payload: StartBoardVotingPayload | undefined,
  ): Promise<void> {
    await this.access.assertActiveEditAccess(actor.userId, boardId);
    const votesPerParticipant = payload?.votesPerParticipant;
    const maxPerItem = payload?.maxPerItem;
    if (!isValidVotingLimits(votesPerParticipant, maxPerItem)) {
      throw new ValidationError('Недопустимые параметры голосования');
    }
    const repo = this.createRepository(this.db);
    const itemIds = await this.resolveScope(repo, boardId, payload?.itemIds);
    try {
      await repo.insert({
        boardId,
        createdBy: actor.userId,
        votesPerParticipant: votesPerParticipant as number | null,
        maxPerItem: maxPerItem as number | null,
        itemIds,
        withTimer: payload?.startTimer === true,
      });
    } catch (err) {
      if (isUniqueViolation(err, 'board_votings_one_active_idx')) {
        throw new ConflictError('На доске уже идёт голосование');
      }
      throw err;
    }
  }

  async vote(
    voter: BoardVoter,
    boardId: string,
    payload: BoardVotePayload | undefined,
  ): Promise<void> {
    const board = await this.access.assertViewAccess(voter.userId, boardId);
    if (board.status !== 'active') throw new ConflictError('Доска в архиве');
    const delta = payload?.delta;
    if (
      !payload ||
      !isUuid(payload.votingId) ||
      !isUuid(payload.itemId) ||
      (delta !== 1 && delta !== -1)
    ) {
      throw new ValidationError('Некорректный голос');
    }

    await this.db.transaction(async (tx) => {
      const repo = this.createRepository(tx);
      const voting = await repo.lock(boardId, payload.votingId);
      if (!voting) throw new NotFoundError('Голосование не найдено');
      if (voting.status !== 'active') throw new ConflictError('Голосование уже завершено');

      const [item] = await repo.listItemContents(boardId, [payload.itemId]);
      if (!item || !isVotableContent(item.content)) {
        throw new ValidationError('За этот элемент голосовать нельзя');
      }
      if (voting.itemIds && !voting.itemIds.includes(item.id)) {
        throw new ValidationError('Этот элемент не участвует в голосовании');
      }

      const mine = await repo.listParticipantVotes(voting.id, voter.participantId);
      const used = mine.reduce((sum, vote) => sum + vote.count, 0);
      const current = mine.find((vote) => vote.itemId === item.id)?.count ?? 0;
      if (delta === 1) {
        const limit = voting.votesPerParticipant;
        if (limit !== null && used >= limit) throw new ConflictError('Голоса закончились');
        if (current >= effectiveMaxPerItem(voting)) {
          throw new ConflictError('За этот элемент больше голосовать нельзя');
        }
      } else if (current === 0) {
        return;
      }
      await repo.setVote(voting.id, item.id, voter, current + delta);
    });
  }

  /** Завершение; ответ — запускало ли голосование таймер (тогда его сбрасывают) */
  async close(
    actor: BoardVoter,
    boardId: string,
    votingId: unknown,
  ): Promise<{ withTimer: boolean }> {
    return this.mutate(actor, boardId, votingId, (repo, id) => repo.close(boardId, id));
  }

  /** Отмена удаляет голосование вместе с голосами; ответ — как у `close` */
  async cancel(
    actor: BoardVoter,
    boardId: string,
    votingId: unknown,
  ): Promise<{ withTimer: boolean }> {
    return this.mutate(actor, boardId, votingId, (repo, id) => repo.cancel(boardId, id));
  }

  /** Удалить завершённое голосование из истории — тот, кто может править доску */
  async delete(actor: BoardVoter, boardId: string, votingId: unknown): Promise<void> {
    await this.access.assertActiveEditAccess(actor.userId, boardId);
    if (!isUuid(votingId)) throw new ValidationError('Не указано голосование');
    const deleted = await this.createRepository(this.db).deleteClosed(boardId, votingId);
    if (!deleted) throw new NotFoundError('Голосование не найдено');
  }

  /**
   * Касается ли правка голосований: удалённый элемент уносит свои голоса из
   * итогов, восстановленный (undo) — возвращает. Иначе снимок голосования
   * рассылать незачем — это персональная рассылка каждому на доске.
   */
  async affectsVotes(boardId: string, itemIds: readonly string[]): Promise<boolean> {
    return this.createRepository(this.db).hasVotesFor(boardId, itemIds);
  }

  /** История завершённых голосований доски — любой, кто видит доску */
  async history(viewer: BoardVoter, boardId: string): Promise<BoardVotingSummary[]> {
    await this.access.assertViewAccess(viewer.userId, boardId);
    return this.createRepository(this.db).listHistory(boardId);
  }

  /** Итоги завершённого голосования из истории глазами `viewer` */
  async results(viewer: BoardVoter, boardId: string, votingId: unknown): Promise<BoardVotingState> {
    await this.access.assertViewAccess(viewer.userId, boardId);
    if (!isUuid(votingId)) throw new ValidationError('Не указано голосование');
    const repo = this.createRepository(this.db);
    const voting = await repo.findClosed(boardId, votingId);
    if (!voting) throw new NotFoundError('Голосование не найдено');
    return votingStateFor({ voting, votes: await repo.listVotes(voting.id) }, viewer.participantId);
  }

  private async mutate(
    actor: BoardVoter,
    boardId: string,
    votingId: unknown,
    change: (
      repo: BoardVotingRepository,
      votingId: string,
    ) => Promise<{ withTimer: boolean } | null>,
  ): Promise<{ withTimer: boolean }> {
    await this.access.assertActiveEditAccess(actor.userId, boardId);
    if (!isUuid(votingId)) throw new ValidationError('Не указано голосование');
    const changed = await change(this.createRepository(this.db), votingId);
    if (!changed) throw new ConflictError('Голосование уже завершено');
    return changed;
  }

  /**
   * Скоуп голосования: только элементы этой доски, за которые можно голосовать.
   * Чужие и нетекстовые id отбрасываются молча (выделение могло захватить
   * картинку или рамку), но совсем пустой скоуп — ошибка.
   */
  private async resolveScope(
    repo: BoardVotingRepository,
    boardId: string,
    raw: unknown,
  ): Promise<string[] | null> {
    if (raw === undefined || raw === null) return null;
    if (!Array.isArray(raw) || raw.length > BOARD_VOTING_MAX_SCOPE_ITEMS || !raw.every(isUuid)) {
      throw new ValidationError('Некорректный список элементов голосования');
    }
    const items = await repo.listItemContents(boardId, [...new Set(raw)]);
    const votable = items.filter((item) => isVotableContent(item.content)).map((item) => item.id);
    if (votable.length === 0) {
      throw new ValidationError('Среди выбранных элементов нет стикеров, фигур или текста');
    }
    return votable;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
