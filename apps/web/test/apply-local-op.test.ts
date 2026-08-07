import type { BoardCommittedOp, BoardEdge, BoardItem } from '@poker/shared';
import { describe, expect, it } from 'vitest';

import { applyLocalBoardOp, type BoardLocalState } from '../src/lib/board/apply-local-op';

function emptyState(): BoardLocalState {
  return { items: new Map(), edges: new Map() };
}

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
  style: { color: '#A8CAFF', line: 'straight', markerStart: 'none', markerEnd: 'none' },
};

describe('applyLocalBoardOp', () => {
  it('item.create добавляет элемент', () => {
    const state = emptyState();
    const op: BoardCommittedOp = { type: 'item.create', clientOpId: 'c1', item };

    applyLocalBoardOp(state, op);

    expect(state.items.get('i1')).toEqual(item);
  });

  it('item.patch заменяет элемент целиком (не мержит патч сам)', () => {
    const state = emptyState();
    state.items.set('i1', item);
    const patched: BoardItem = { ...item, x: 500 };

    applyLocalBoardOp(state, { type: 'item.patch', clientOpId: 'c2', item: patched });

    expect(state.items.get('i1')).toEqual(patched);
  });

  it('item.delete убирает элемент', () => {
    const state = emptyState();
    state.items.set('i1', item);

    applyLocalBoardOp(state, { type: 'item.delete', clientOpId: 'c3', id: 'i1' });

    expect(state.items.has('i1')).toBe(false);
  });

  it('edge.create добавляет связь', () => {
    const state = emptyState();

    applyLocalBoardOp(state, { type: 'edge.create', clientOpId: 'c4', edge });

    expect(state.edges.get('e1')).toEqual(edge);
  });

  it('edge.patch заменяет связь целиком', () => {
    const state = emptyState();
    state.edges.set('e1', edge);
    const patched: BoardEdge = { ...edge, label: 'зависит от' };

    applyLocalBoardOp(state, { type: 'edge.patch', clientOpId: 'c5', edge: patched });

    expect(state.edges.get('e1')).toEqual(patched);
  });

  it('edge.delete убирает связь', () => {
    const state = emptyState();
    state.edges.set('e1', edge);

    applyLocalBoardOp(state, { type: 'edge.delete', clientOpId: 'c6', id: 'e1' });

    expect(state.edges.has('e1')).toBe(false);
  });
});
