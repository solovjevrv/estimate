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
 * Итоги (`results`) — только у завершённого и не скрытого голосования.
 */
export interface BoardVotingState {
  id: string;
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
  /** По убыванию `total`; null, пока голосование идёт */
  results: BoardVotingResult[] | null;
}

export const BOARD_VOTING_DEFAULT_VOTES = 3;
export const BOARD_VOTING_DEFAULT_MAX_PER_ITEM = 3;
export const BOARD_VOTING_MAX_VOTES = 20;
/** Список элементов скоупа не может быть длиннее самой доски — потолок на размер payload */
export const BOARD_VOTING_MAX_SCOPE_ITEMS = 500;

/** За что можно голосовать: текстовые элементы — стикер, фигура, текст */
export function isVotableContent(content: BoardItemContent): boolean {
  return content.type === 'sticky' || content.type === 'shape' || content.type === 'text';
}

/** Параметры голосования, которые примет сервер */
export function isValidVotingLimits(votesPerParticipant: unknown, maxPerItem: unknown): boolean {
  return (
    Number.isInteger(votesPerParticipant) &&
    Number.isInteger(maxPerItem) &&
    (votesPerParticipant as number) >= 1 &&
    (votesPerParticipant as number) <= BOARD_VOTING_MAX_VOTES &&
    (maxPerItem as number) >= 1 &&
    (maxPerItem as number) <= (votesPerParticipant as number)
  );
}

export interface StartBoardVotingPayload {
  votesPerParticipant: number;
  maxPerItem: number;
  /** Скоуп: выделенные элементы или элементы фрейма; null/без поля — вся доска */
  itemIds?: string[] | null;
}

export interface BoardVotePayload {
  votingId: string;
  itemId: string;
  delta: 1 | -1;
}

/** Завершить/отменить/скрыть итоги — всегда конкретное голосование, а не «текущее» */
export interface BoardVotingRefPayload {
  votingId: string;
}
