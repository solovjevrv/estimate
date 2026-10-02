/**
 * Голосование точками на доске (15.2). Не содержимое доски: голоса не идут
 * через журнал `BoardOp` и undo, а до завершения каждому видны только свои —
 * поэтому у голосования свой канал (`board:voting:*`) и персональная
 * рассылка `board:voting`, а не общий `board:ops`.
 */
import type { BoardItemContent } from './entities';

export type BoardVotingStatus = 'active' | 'closed';

/** Сколько точек участник поставил одному элементу и кто он — для подсказки авторов в итогах */
export interface BoardVoteAuthor {
  participantId: string;
  name: string;
  count: number;
}

export interface BoardVotingResult {
  itemId: string;
  total: number;
  /** По убыванию числа точек, затем по имени */
  authors: BoardVoteAuthor[];
}

/**
 * Снимок голосования глазами конкретного участника. Пока идёт голосование,
 * чужие голоса не раскрываются: только свои (`myVotes`) и число проголосовавших.
 * Итоги (`results`) — только у завершённого голосования.
 */
export interface BoardVotingState {
  id: string;
  /** Порядковый номер голосования на доске — «Голосование 2» */
  number: number;
  status: BoardVotingStatus;
  votesPerParticipant: number;
  maxPerItem: number;
  /** Элементы, за которые можно голосовать; null — вся доска */
  itemIds: string[] | null;
  startedAt: string;
  closedAt: string | null;
  /** Свои точки по элементам (itemId → число) */
  myVotes: Record<string, number>;
  myRemaining: number;
  /** Сколько участников поставили хотя бы одну точку */
  votedCount: number;
  /** Сколько участников использовали все свои точки — для предупреждения при завершении */
  completedCount: number;
  /** По убыванию `total`; null, пока голосование идёт */
  results: BoardVotingResult[] | null;
}

export const BOARD_VOTING_DEFAULT_VOTES = 5;
export const BOARD_VOTING_DEFAULT_MAX_PER_ITEM = 2;
export const BOARD_VOTING_MAX_VOTES = 20;
/** Список элементов скоупа не может быть длиннее самой доски — потолок на размер payload */
export const BOARD_VOTING_MAX_SCOPE_ITEMS = 500;

/** За что можно голосовать: текстовые элементы — стикер, фигура, текст */
export function isVotableContent(content: BoardItemContent): boolean {
  return content.type === 'sticky' || content.type === 'shape' || content.type === 'text';
}

/**
 * Параметры голосования, которые примет сервер. Лимиты независимы: если «на
 * элемент» больше «на человека», упрёшься в меньший (`effectiveMaxPerItem`).
 */
export function isValidVotingLimits(votesPerParticipant: unknown, maxPerItem: unknown): boolean {
  const inRange = (value: unknown): boolean =>
    Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= BOARD_VOTING_MAX_VOTES;
  return inRange(votesPerParticipant) && inRange(maxPerItem);
}

/** Сколько точек на самом деле можно поставить одному элементу */
export function effectiveMaxPerItem(
  state: Pick<BoardVotingState, 'votesPerParticipant' | 'maxPerItem'>,
): number {
  return Math.min(state.votesPerParticipant, state.maxPerItem);
}

/** Строка истории голосований доски — без голосов, только сводка */
export interface BoardVotingSummary {
  id: string;
  number: number;
  startedAt: string;
  closedAt: string | null;
  totalVotes: number;
  voterCount: number;
}

export interface StartBoardVotingPayload {
  votesPerParticipant: number;
  maxPerItem: number;
  /** Скоуп: выделенные элементы или элементы фрейма; null/без поля — вся доска */
  itemIds?: string[] | null;
  /** Перезапустить таймер доски вместе с голосованием; завершение/отмена его сбросят */
  startTimer?: boolean;
}

export interface BoardVotePayload {
  votingId: string;
  itemId: string;
  delta: 1 | -1;
}

/** Завершить/отменить/открыть итоги — всегда конкретное голосование, а не «текущее» */
export interface BoardVotingRefPayload {
  votingId: string;
}
