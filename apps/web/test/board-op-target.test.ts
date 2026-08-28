import type { BoardCommittedOp, BoardEdge, BoardItem, BoardOp } from '@estimate/shared';
import { describe, expect, it } from 'vitest';

import { opTargetKey } from '../src/features/boards/domain/board-op-target';

const item: BoardItem = {
  id: 'i1',
  boardId: 'b1',
  parentId: null,
  x: 10,
  y: 20,
  width: 160,
  height: 120,
  rotation: 0,
  zIndex: 0,
  content: { type: 'sticky', text: 'Привет' },
  style: { color: '#FCEB96' },
  reactions: [],
  createdBy: 'u1',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const edge: BoardEdge = {
  id: 'e1',
  boardId: 'b1',
  sourceItemId: 'i1',
  targetItemId: 'i2',
  sourceHandle: null,
  targetHandle: null,
  label: null,
  style: {
    color: '#A8CAFF',
    line: 'straight',
    dash: 'solid',
    markerStart: 'none',
    markerEnd: 'none',
  },
  zIndex: 1,
};

describe('opTargetKey — BoardOp (клиент → сервер) (17.7)', () => {
  it.each<[string, BoardOp, string]>([
    ['item.create', { type: 'item.create', clientOpId: 'c1', item }, 'item:i1'],
    ['item.patch', { type: 'item.patch', clientOpId: 'c1', id: 'i1', patch: { x: 5 } }, 'item:i1'],
    ['item.delete', { type: 'item.delete', clientOpId: 'c1', id: 'i1' }, 'item:i1'],
    ['item.react', { type: 'item.react', clientOpId: 'c1', id: 'i1', emoji: '👍' }, 'item:i1'],
    ['edge.create', { type: 'edge.create', clientOpId: 'c1', edge }, 'edge:e1'],
    [
      'edge.patch',
      { type: 'edge.patch', clientOpId: 'c1', id: 'e1', patch: { label: 'x' } },
      'edge:e1',
    ],
    ['edge.delete', { type: 'edge.delete', clientOpId: 'c1', id: 'e1' }, 'edge:e1'],
  ])('%s → %s', (_name, op, expected) => {
    expect(opTargetKey(op)).toBe(expected);
  });
});

describe('opTargetKey — BoardCommittedOp (рассылка сервера) (17.7)', () => {
  it.each<[string, BoardCommittedOp, string]>([
    ['item.create', { type: 'item.create', clientOpId: 'c1', item }, 'item:i1'],
    ['item.patch', { type: 'item.patch', clientOpId: 'c1', item }, 'item:i1'],
    ['item.delete', { type: 'item.delete', clientOpId: 'c1', id: 'i1' }, 'item:i1'],
    ['edge.create', { type: 'edge.create', clientOpId: 'c1', edge }, 'edge:e1'],
    ['edge.patch', { type: 'edge.patch', clientOpId: 'c1', edge }, 'edge:e1'],
    ['edge.delete', { type: 'edge.delete', clientOpId: 'c1', id: 'e1' }, 'edge:e1'],
  ])('%s → %s', (_name, op, expected) => {
    expect(opTargetKey(op)).toBe(expected);
  });
});
