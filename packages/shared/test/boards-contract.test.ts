import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  BOARD_OPS_BATCH_MAX,
  BOARD_RING_BUFFER_SIZE,
  BOARD_WS_EVENTS,
  BOARD_WS_SERVER_EVENTS,
  isBoardContainer,
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
    ]);
    expect(Object.values(BOARD_WS_SERVER_EVENTS)).toEqual([
      'board:ops',
      'board:awareness',
      'board:presence',
    ]);
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
