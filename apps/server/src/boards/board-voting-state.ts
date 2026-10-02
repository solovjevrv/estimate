import type { BoardVoteAuthor, BoardVotingResult, BoardVotingState } from '@estimate/shared';

/** Голосование как оно лежит в БД — без голосов */
export interface BoardVotingRecord {
  id: string;
  boardId: string;
  status: 'active' | 'closed';
  votesPerParticipant: number;
  maxPerItem: number;
  itemIds: string[] | null;
  withTimer: boolean;
  /** Порядковый номер на доске — «Голосование 2» */
  number: number;
  startedAt: Date;
  closedAt: Date | null;
}

export interface BoardVoteRecord {
  itemId: string;
  participantId: string;
  participantName: string;
  count: number;
}

/** Текущее голосование доски со всеми голосами — из него собирается снимок каждому участнику */
export interface BoardVotingSnapshot {
  voting: BoardVotingRecord;
  votes: BoardVoteRecord[];
}

/**
 * Снимок голосования глазами участника. Пока голосование идёт, чужие голоса
 * не раскрываются — только свои и число проголосовавших; итоги с авторами —
 * у завершённого голосования.
 */
export function votingStateFor(
  snapshot: BoardVotingSnapshot,
  participantId: string,
): BoardVotingState {
  const { voting, votes } = snapshot;
  const myVotes: Record<string, number> = {};
  let used = 0;
  const usedBy = new Map<string, number>();
  for (const vote of votes) {
    usedBy.set(vote.participantId, (usedBy.get(vote.participantId) ?? 0) + vote.count);
    if (vote.participantId === participantId) {
      myVotes[vote.itemId] = vote.count;
      used += vote.count;
    }
  }
  let completedCount = 0;
  for (const total of usedBy.values()) {
    if (total >= voting.votesPerParticipant) completedCount += 1;
  }
  return {
    id: voting.id,
    number: voting.number,
    status: voting.status,
    votesPerParticipant: voting.votesPerParticipant,
    maxPerItem: voting.maxPerItem,
    itemIds: voting.itemIds,
    startedAt: voting.startedAt.toISOString(),
    closedAt: voting.closedAt?.toISOString() ?? null,
    myVotes,
    myRemaining: Math.max(0, voting.votesPerParticipant - used),
    votedCount: usedBy.size,
    completedCount,
    results: voting.status === 'closed' ? votingResults(votes) : null,
  };
}

/** Итоги по элементам: по убыванию числа голосов, авторы — по убыванию своих точек, затем по имени */
export function votingResults(votes: readonly BoardVoteRecord[]): BoardVotingResult[] {
  const byItem = new Map<string, BoardVoteAuthor[]>();
  for (const vote of votes) {
    const authors = byItem.get(vote.itemId) ?? [];
    authors.push({
      participantId: vote.participantId,
      name: vote.participantName,
      count: vote.count,
    });
    byItem.set(vote.itemId, authors);
  }
  const results = [...byItem].map(([itemId, authors]) => ({
    itemId,
    total: authors.reduce((sum, author) => sum + author.count, 0),
    authors: authors.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')),
  }));
  return results.sort((a, b) => b.total - a.total || a.itemId.localeCompare(b.itemId));
}
