import type { BoardCommittedOp, BoardEdge, BoardItem } from '@poker/shared';
import { describe, expect, it } from 'vitest';

import {
  applyLocalBoardOp,
  type BoardLocalState,
} from '../src/features/boards/domain/apply-local-op';

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

  it('item.delete каскадно убирает связи удалённого элемента (12.9-багфикс)', () => {
    // Сервер каскадно удаляет связи вместе с элементом (board-ops.ts), но
    // рассылает только сам item.delete — без этого локального каскада
    // "осиротевшая" связь на несуществующий узел ломала Vue Flow (TypeError
    // при рендере пути) и замораживала холст до перезагрузки страницы
    const state = emptyState();
    const item2: BoardItem = { ...item, id: 'i2' };
    state.items.set('i1', item);
    state.items.set('i2', item2);
    state.edges.set('e1', edge); // sourceItemId: 'i1', targetItemId: 'i2'

    applyLocalBoardOp(state, { type: 'item.delete', clientOpId: 'c3', id: 'i1' });

    expect(state.items.has('i1')).toBe(false);
    expect(state.edges.has('e1')).toBe(false);
  });

  it('item.delete не трогает связи других элементов', () => {
    const state = emptyState();
    const item2: BoardItem = { ...item, id: 'i2' };
    const item3: BoardItem = { ...item, id: 'i3' };
    state.items.set('i1', item);
    state.items.set('i2', item2);
    state.items.set('i3', item3);
    const unrelatedEdge: BoardEdge = { ...edge, id: 'e2', sourceItemId: 'i2', targetItemId: 'i3' };
    state.edges.set('e2', unrelatedEdge);

    applyLocalBoardOp(state, { type: 'item.delete', clientOpId: 'c3', id: 'i1' });

    expect(state.edges.has('e2')).toBe(true);
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

describe('applyLocalBoardOp — фреймы и группы (14.3)', () => {
  it('item.create контейнера с parentId устанавливает parentNode локально', () => {
    const state = emptyState();
    const frame: BoardItem = {
      ...item,
      id: 'frame',
      content: { type: 'frame', title: 'Группа' },
      parentId: null,
    };
    state.items.set('frame', frame);
    const child: BoardItem = { ...item, id: 'child', parentId: 'frame' };

    applyLocalBoardOp(state, { type: 'item.create', clientOpId: 'c1', item: child });

    expect(state.items.get('child')!.parentId).toBe('frame');
  });

  it('item.patch parentId на существующий контейнер — ок', () => {
    const state = emptyState();
    const frame: BoardItem = {
      ...item,
      id: 'frame',
      content: { type: 'frame', title: 'Группа' },
      parentId: null,
    };
    state.items.set('frame', frame);
    const child: BoardItem = { ...item, id: 'child', parentId: null };
    state.items.set('child', child);

    applyLocalBoardOp(state, {
      type: 'item.patch',
      clientOpId: 'c2',
      item: { ...child, parentId: 'frame' },
    });

    expect(state.items.get('child')!.parentId).toBe('frame');
  });

  it('item.delete контейнера осирает детей (parentId → null)', () => {
    const state = emptyState();
    const frame: BoardItem = {
      ...item,
      id: 'frame',
      content: { type: 'frame', title: 'Группа' },
      parentId: null,
    };
    const child: BoardItem = { ...item, id: 'child', parentId: 'frame' };
    state.items.set('frame', frame);
    state.items.set('child', child);

    applyLocalBoardOp(state, { type: 'item.delete', clientOpId: 'c3', id: 'frame' });

    expect(state.items.has('frame')).toBe(false);
    expect(state.items.get('child')!.parentId).toBeNull();
  });

  it('item.delete контейнера НЕ удаляет детей', () => {
    const state = emptyState();
    const frame: BoardItem = {
      ...item,
      id: 'frame',
      content: { type: 'group' },
      parentId: null,
    };
    const child: BoardItem = { ...item, id: 'child', parentId: 'frame' };
    state.items.set('frame', frame);
    state.items.set('child', child);

    applyLocalBoardOp(state, { type: 'item.delete', clientOpId: 'c3', id: 'frame' });

    expect(state.items.has('child')).toBe(true);
    expect(state.items.get('child')!.parentId).toBeNull();
  });

  it('item.patch, демотирующий контейнер до стикера, осирает детей', () => {
    const state = emptyState();
    const frame: BoardItem = {
      ...item,
      id: 'frame',
      content: { type: 'frame', title: 'Группа' },
      parentId: null,
    };
    const child: BoardItem = { ...item, id: 'child', parentId: 'frame' };
    state.items.set('frame', frame);
    state.items.set('child', child);

    applyLocalBoardOp(state, {
      type: 'item.patch',
      clientOpId: 'c4',
      item: { ...frame, content: { type: 'sticky', text: '' } },
    });

    expect(state.items.get('frame')!.content.type).toBe('sticky');
    expect(state.items.get('child')!.parentId).toBeNull();
  });

  it('item.patch, меняющий frame → group, НЕ осирает детей (group тоже контейнер)', () => {
    const state = emptyState();
    const frame: BoardItem = {
      ...item,
      id: 'frame',
      content: { type: 'frame', title: 'Группа' },
      parentId: null,
    };
    const child: BoardItem = { ...item, id: 'child', parentId: 'frame' };
    state.items.set('frame', frame);
    state.items.set('child', child);

    applyLocalBoardOp(state, {
      type: 'item.patch',
      clientOpId: 'c5',
      item: { ...frame, content: { type: 'group' } },
    });

    expect(state.items.get('frame')!.content.type).toBe('group');
    expect(state.items.get('child')!.parentId).toBe('frame');
  });
});
