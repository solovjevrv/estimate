/**
 * Снимок голосования глазами участника (15.2): что раскрывается до и после
 * завершения. Чистая логика без БД.
 */
import { describe, expect, it } from 'vitest';

import {
  votingResults,
  votingStateFor,
  type BoardVotingSnapshot,
} from '../src/boards/board-voting-state';

function snapshot(status: 'active' | 'closed'): BoardVotingSnapshot {
  return {
    voting: {
      id: 'v1',
      boardId: 'b1',
      status,
      votesPerParticipant: 3,
      maxPerItem: 2,
      itemIds: null,
      withTimer: false,
      number: 2,
      startedAt: new Date('2026-10-02T10:00:00.000Z'),
      closedAt: status === 'closed' ? new Date('2026-10-02T10:05:00.000Z') : null,
    },
    votes: [
      { itemId: 'a', participantId: 'anna', participantName: 'Анна', count: 2 },
      { itemId: 'b', participantId: 'anna', participantName: 'Анна', count: 1 },
      { itemId: 'b', participantId: 'ivan', participantName: 'Иван', count: 2 },
      { itemId: 'c', participantId: 'boris', participantName: 'Борис', count: 1 },
    ],
  };
}

describe('votingStateFor', () => {
  it('пока голосование идёт, видны только свои точки и число проголосовавших', () => {
    const state = votingStateFor(snapshot('active'), 'anna');

    expect(state.myVotes).toEqual({ a: 2, b: 1 });
    expect(state.myRemaining).toBe(0);
    expect(state.votedCount).toBe(3);
    // Все 3 точки потратила только Анна
    expect(state.completedCount).toBe(1);
    expect(state.number).toBe(2);
    expect(state.results).toBeNull();
    expect(JSON.stringify(state)).not.toContain('Иван');
  });

  it('у не голосовавшего — пусто и весь запас голосов', () => {
    const state = votingStateFor(snapshot('active'), 'maria');

    expect(state.myVotes).toEqual({});
    expect(state.myRemaining).toBe(3);
  });

  it('после завершения — итоги с авторами по убыванию', () => {
    const state = votingStateFor(snapshot('closed'), 'maria');

    expect(state.closedAt).toBe('2026-10-02T10:05:00.000Z');
    expect(state.results?.map((r) => [r.itemId, r.total])).toEqual([
      ['b', 3],
      ['a', 2],
      ['c', 1],
    ]);
    expect(state.results?.[0]?.authors.map((a) => a.name)).toEqual(['Иван', 'Анна']);
  });
});

describe('votingResults', () => {
  it('при равенстве авторов упорядочивает по имени', () => {
    const results = votingResults([
      { itemId: 'x', participantId: '2', participantName: 'Яна', count: 1 },
      { itemId: 'x', participantId: '1', participantName: 'Алла', count: 1 },
    ]);

    expect(results[0]?.authors.map((a) => a.name)).toEqual(['Алла', 'Яна']);
  });
});
