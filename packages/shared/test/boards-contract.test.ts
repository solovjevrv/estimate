import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  BOARD_OPS_BATCH_MAX,
  BOARD_RING_BUFFER_SIZE,
  BOARD_TIMER_DEFAULT_DURATION_SEC,
  BOARD_TIMER_PRESETS_SEC,
  BOARD_WS_EVENTS,
  BOARD_WS_SERVER_EVENTS,
  isBoardContainer,
  isValidBoardTimerDuration,
  effectiveMaxPerItem,
  isValidVotingLimits,
  isArrangeableContent,
  isVotableContent,
  type ApplyBoardOpsPayload,
  type ApplyBoardOpsResult,
  type BoardCommittedOp,
  type BoardOp,
  type BoardOpsBatch,
  type JoinBoardPayload,
  type JoinBoardResult,
} from '../src/index';

describe('контракт realtime-доски', () => {
  it('фиксирует имена клиентских и серверных событий', () => {
    expect(Object.values(BOARD_WS_EVENTS)).toEqual([
      'board:join',
      'board:apply',
      'board:awareness',
      'board:timer:start',
      'board:timer:pause',
      'board:timer:reset',
      'board:timer:extend',
      'board:voting:start',
      'board:voting:vote',
      'board:voting:close',
      'board:voting:cancel',
      'board:voting:history',
      'board:voting:results',
      'board:voting:delete',
    ]);
    expect(Object.values(BOARD_WS_SERVER_EVENTS)).toEqual([
      'board:ops',
      'board:awareness',
      'board:presence',
      'board:timer',
      'board:voting',
      'board:estimate',
      'board:access',
    ]);
  });

  it('длительность таймера доски — целые минуты от 1 до 120 (15.3)', () => {
    expect(BOARD_TIMER_PRESETS_SEC.every(isValidBoardTimerDuration)).toBe(true);
    expect(isValidBoardTimerDuration(BOARD_TIMER_DEFAULT_DURATION_SEC)).toBe(true);
    expect(isValidBoardTimerDuration(60)).toBe(true);
    expect(isValidBoardTimerDuration(7200)).toBe(true);
    for (const invalid of [0, 30, 90, 7260, 300.5, Number.NaN]) {
      expect(isValidBoardTimerDuration(invalid)).toBe(false);
    }
  });

  it('голосование: лимиты точек и элементы, за которые можно голосовать (15.2)', () => {
    expect(isValidVotingLimits(3, 3)).toBe(true);
    expect(isValidVotingLimits(20, 1)).toBe(true);
    // Независимые лимиты: «на элемент» больше «на человека» — допустимо
    expect(isValidVotingLimits(2, 5)).toBe(true);
    expect(effectiveMaxPerItem({ votesPerParticipant: 2, maxPerItem: 5 })).toBe(2);
    // Без ограничения — один из лимитов, но не оба
    expect(isValidVotingLimits(null, 1)).toBe(true);
    expect(isValidVotingLimits(5, null)).toBe(true);
    expect(isValidVotingLimits(null, null)).toBe(false);
    expect(effectiveMaxPerItem({ votesPerParticipant: null, maxPerItem: 1 })).toBe(1);
    expect(effectiveMaxPerItem({ votesPerParticipant: 3, maxPerItem: null })).toBe(3);
    for (const [votes, perItem] of [
      [0, 1],
      [3, 21],
      [21, 1],
      [2.5, 1],
      ['3', 1],
    ] as const) {
      expect(isValidVotingLimits(votes, perItem)).toBe(false);
    }
    expect(isVotableContent({ type: 'sticky', text: '' })).toBe(true);
    // Только стикеры (решение 07.10.2026): фигуры и текст — оформление
    expect(isVotableContent({ type: 'shape', shape: 'rectangle', text: '' })).toBe(false);
    expect(isVotableContent({ type: 'text', text: '' })).toBe(false);
    expect(isArrangeableContent({ type: 'shape', shape: 'rectangle', text: '' })).toBe(true);
    expect(isArrangeableContent({ type: 'text', text: '' })).toBe(true);
    expect(isArrangeableContent({ type: 'emoji', emoji: '👍' })).toBe(false);
    expect(isVotableContent({ type: 'emoji', emoji: '👍' })).toBe(false);
    expect(isVotableContent({ type: 'frame', title: '' })).toBe(false);
  });

  it('фиксирует лимиты операции и буфера догона', () => {
    expect(BOARD_OPS_BATCH_MAX).toBe(50);
    expect(BOARD_RING_BUFFER_SIZE).toBe(200);
  });

  it('держит дискриминированные union-формы операций совместимыми', () => {
    expectTypeOf<BoardOp['type']>().toEqualTypeOf<
      | 'item.create'
      | 'item.patch'
      | 'item.delete'
      | 'item.react'
      | 'edge.create'
      | 'edge.patch'
      | 'edge.delete'
    >();
    expectTypeOf<BoardCommittedOp['type']>().toEqualTypeOf<
      'item.create' | 'item.patch' | 'item.delete' | 'edge.create' | 'edge.patch' | 'edge.delete'
    >();
  });

  it('держит формы WS-payload и ack результата', () => {
    expectTypeOf<ApplyBoardOpsPayload>().toMatchTypeOf<{ ops: BoardOp[] }>();
    expectTypeOf<ApplyBoardOpsResult>().toEqualTypeOf<{ revision: number }>();
    expectTypeOf<JoinBoardPayload>().toMatchTypeOf<{ boardId: string }>();
    expectTypeOf<JoinBoardResult>().toMatchTypeOf<{
      revision: number;
      participantId: string;
      guestToken: string | null;
    }>();
    expectTypeOf<BoardOpsBatch>().toMatchTypeOf<{
      revision: number;
      ops: BoardCommittedOp[];
    }>();
  });

  it('фиксирует единственные типы контейнеров', () => {
    expect(isBoardContainer('frame')).toBe(true);
    expect(isBoardContainer('group')).toBe(true);
    expect(isBoardContainer('sticky')).toBe(false);
    expect(isBoardContainer('shape')).toBe(false);
  });
});
