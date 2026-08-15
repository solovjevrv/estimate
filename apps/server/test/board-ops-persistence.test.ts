import type { BoardEdge, BoardItem, BoardOp } from '@poker/shared';
import { describe, expect, it, vi } from 'vitest';

import { persistBoardOps } from '../src/boards/board-ops.persistence';
import type { BoardsRepository } from '../src/boards/boards.repository';

const BOARD_ID = 'board-1';
const ITEM: BoardItem = {
  id: 'item-1',
  boardId: BOARD_ID,
  parentId: null,
  x: 100,
  y: 200,
  width: 160,
  height: 120,
  rotation: 0,
  zIndex: 1,
  content: { type: 'sticky', text: 'Готовая запись' },
  style: { color: '#FCEB96' },
  reactions: [],
  createdBy: 'user-1',
  updatedAt: '2026-08-15T12:00:00.000Z',
};

const EDGE: BoardEdge = {
  id: 'edge-1',
  boardId: BOARD_ID,
  sourceItemId: 'item-1',
  targetItemId: 'item-2',
  sourceHandle: null,
  targetHandle: null,
  label: 'Связь',
  style: { line: 'straight', markerStart: 'none', markerEnd: 'arrow' },
};

function repository(): {
  repository: Pick<
    BoardsRepository,
    'insertItem' | 'updateItem' | 'deleteItem' | 'insertEdge' | 'updateEdge' | 'deleteEdge'
  >;
  insertItem: ReturnType<typeof vi.fn>;
  updateItem: ReturnType<typeof vi.fn>;
  deleteItem: ReturnType<typeof vi.fn>;
  insertEdge: ReturnType<typeof vi.fn>;
  updateEdge: ReturnType<typeof vi.fn>;
  deleteEdge: ReturnType<typeof vi.fn>;
} {
  const insertItem = vi.fn(async () => ITEM);
  const updateItem = vi.fn(async () => ITEM);
  const deleteItem = vi.fn(async () => false);
  const insertEdge = vi.fn(async () => EDGE);
  const updateEdge = vi.fn(async () => EDGE);
  const deleteEdge = vi.fn(async () => false);
  return {
    repository: { insertItem, updateItem, deleteItem, insertEdge, updateEdge, deleteEdge },
    insertItem,
    updateItem,
    deleteItem,
    insertEdge,
    updateEdge,
    deleteEdge,
  };
}

describe('persistBoardOps', () => {
  it('диспетчеризует все типы, сохраняет порядок и пишет готовый state вместо сырых patch', async () => {
    const repo = repository();
    const ops: BoardOp[] = [
      {
        type: 'item.create',
        clientOpId: 'create-item',
        item: {
          id: ITEM.id,
          parentId: ITEM.parentId,
          x: ITEM.x,
          y: ITEM.y,
          width: ITEM.width,
          height: ITEM.height,
          rotation: ITEM.rotation,
          zIndex: ITEM.zIndex,
          content: ITEM.content,
          style: ITEM.style,
          reactions: ITEM.reactions,
        },
      },
      { type: 'item.patch', clientOpId: 'patch-item', id: ITEM.id, patch: { x: 999 } },
      { type: 'item.react', clientOpId: 'react-item', id: ITEM.id, emoji: '👍' },
      { type: 'item.delete', clientOpId: 'delete-item', id: ITEM.id },
      {
        type: 'edge.create',
        clientOpId: 'create-edge',
        edge: {
          id: EDGE.id,
          sourceItemId: EDGE.sourceItemId,
          targetItemId: EDGE.targetItemId,
          sourceHandle: EDGE.sourceHandle,
          targetHandle: EDGE.targetHandle,
          label: EDGE.label,
          style: EDGE.style,
        },
      },
      { type: 'edge.patch', clientOpId: 'patch-edge', id: EDGE.id, patch: { label: 'Сырой патч' } },
      { type: 'edge.delete', clientOpId: 'delete-edge', id: EDGE.id },
    ];

    const committed = await persistBoardOps(
      {
        repository: repo.repository,
        boardId: BOARD_ID,
        actorUserId: 'user-1',
        state: { items: new Map([[ITEM.id, ITEM]]), edges: new Map([[EDGE.id, EDGE]]) },
      },
      ops,
    );

    expect(committed.map((op) => op.type)).toEqual([
      'item.create',
      'item.patch',
      'item.patch',
      'item.delete',
      'edge.create',
      'edge.patch',
      'edge.delete',
    ]);
    expect(repo.insertItem).toHaveBeenCalledWith(BOARD_ID, 'user-1', ITEM);
    expect(repo.updateItem).toHaveBeenNthCalledWith(1, BOARD_ID, ITEM.id, ITEM);
    expect(repo.updateItem).toHaveBeenNthCalledWith(2, BOARD_ID, ITEM.id, ITEM);
    expect(repo.deleteItem).toHaveBeenCalledWith(BOARD_ID, ITEM.id);
    expect(repo.insertEdge).toHaveBeenCalledWith(BOARD_ID, EDGE);
    expect(repo.updateEdge).toHaveBeenCalledWith(BOARD_ID, EDGE.id, EDGE);
    expect(repo.deleteEdge).toHaveBeenCalledWith(BOARD_ID, EDGE.id);
  });

  it('не рассылает patch/create, если запись исчезла до persist-фазы', async () => {
    const repo = repository();
    const committed = await persistBoardOps(
      {
        repository: repo.repository,
        boardId: BOARD_ID,
        actorUserId: 'user-1',
        state: { items: new Map(), edges: new Map() },
      },
      [
        { type: 'item.patch', clientOpId: 'missing-item', id: ITEM.id, patch: {} },
        { type: 'edge.patch', clientOpId: 'missing-edge', id: EDGE.id, patch: {} },
      ],
    );

    expect(committed).toEqual([]);
    expect(repo.updateItem).not.toHaveBeenCalled();
    expect(repo.updateEdge).not.toHaveBeenCalled();
  });
});
