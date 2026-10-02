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
    ]);
    expect(Object.values(BOARD_WS_SERVER_EVENTS)).toEqual([
      'board:ops',
      'board:awareness',
      'board:presence',
      'board:timer',
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
