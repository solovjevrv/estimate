import type { BoardEdge, BoardItem, BoardOp } from '@poker/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  expandContainerFamily,
  useBoardClipboard,
  type BoardClipboardNode,
} from '../src/features/boards/composables/use-board-clipboard';

function item(id: string, overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    id,
    boardId: 'board-1',
    parentId: null,
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    rotation: 0,
    zIndex: 0,
    content: { type: 'sticky', text: id },
    style: { color: '#FCEB96' },
    reactions: [],
    createdBy: 'user-1',
    updatedAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  };
}

function node(data: BoardItem): BoardClipboardNode {
  return { id: data.id, data };
}

function clipboard(items: BoardItem[], selected: BoardClipboardNode[], edges: BoardEdge[] = []) {
  const applyOps = vi.fn<(ops: BoardOp[]) => void>();
  const clearSelection = vi.fn();
  const selectItems = vi.fn();
  return {
    applyOps,
    clearSelection,
    selectItems,
    api: useBoardClipboard({
      canEdit: () => true,
      getItems: () => items,
      getEdges: () => edges,
      getSelectedNodes: () => selected,
      getCanvasRect: () => ({ width: 400, height: 300 }) as DOMRect,
      project: (point) => point,
      findContainerAt: () => undefined,
      canCreateItems: () => true,
      canApplyOpsCount: () => true,
      uploadImage: vi.fn(),
      createImage: vi.fn(),
      applyOps,
      breakFollowOnEdit: vi.fn(),
      clearSelection,
      selectItems,
    }),
  };
}

describe('expandContainerFamily', () => {
  it('добавляет детей выбранного контейнера и ставит контейнер первым', () => {
    const frame = item('frame', { content: { type: 'frame', title: 'Frame' } });
    const child = item('child', { parentId: frame.id });

    expect(expandContainerFamily([node(frame)], [frame, child]).map(({ id }) => id)).toEqual([
      'frame',
      'child',
    ]);
  });

  it('при выборе члена группы копирует всю группу, но не делает этого для фрейма', () => {
    const group = item('group', { content: { type: 'group' } });
    const groupChild = item('group-child', { parentId: group.id });
    const groupMate = item('group-mate', { parentId: group.id });
    const frame = item('frame', { content: { type: 'frame', title: 'Frame' } });
    const frameChild = item('frame-child', { parentId: frame.id });
    const items = [group, groupChild, groupMate, frame, frameChild];

    expect(expandContainerFamily([node(groupChild)], items).map(({ id }) => id)).toEqual([
      'group',
      'group-child',
      'group-mate',
    ]);
    expect(expandContainerFamily([node(frameChild)], items).map(({ id }) => id)).toEqual([
      'frame-child',
    ]);
  });
});

describe('useBoardClipboard duplicateSelection', () => {
  it('ремапит родителя и обе стороны внутренней связи на новые id', () => {
    const frame = item('frame', { content: { type: 'frame', title: 'Frame' } });
    const child = item('child', { parentId: frame.id });
    const edge: BoardEdge = {
      id: 'edge',
      boardId: 'board-1',
      sourceItemId: frame.id,
      targetItemId: child.id,
      sourceHandle: null,
      targetHandle: null,
      label: null,
      style: { line: 'straight', dash: 'solid', markerStart: 'none', markerEnd: 'arrow' },
    };
    const { api, applyOps } = clipboard([frame, child], [node(frame)], [edge]);

    api.duplicateSelection();

    const ops = applyOps.mock.calls[0]?.[0] ?? [];
    const creates = ops.filter((op) => op.type === 'item.create');
    const copiedFrame = creates.find((op) => op.item.content.type === 'frame');
    const copiedChild = creates.find((op) => op.item.content.type === 'sticky');
    const copiedEdge = ops.find((op) => op.type === 'edge.create');
    expect(copiedFrame).toBeDefined();
    expect(copiedChild?.item.parentId).toBe(copiedFrame?.item.id);
    expect(copiedEdge).toMatchObject({
      edge: { sourceItemId: copiedFrame?.item.id, targetItemId: copiedChild?.item.id },
    });
  });
});

describe('useBoardClipboard pasteBoardItems', () => {
  it('создаёт элементы относительно центра, применяет batch и выделяет только вставленные id', async () => {
    const { api, applyOps, clearSelection, selectItems } = clipboard([], []);

    await api.pasteBoardItems(
      [
        {
          relX: -50,
          relY: -40,
          width: 100,
          height: 80,
          rotation: 0,
          parentIndex: null,
          content: { type: 'sticky', text: 'copied' },
          style: { color: '#FCEB96' },
        },
      ],
      [],
    );

    const created = applyOps.mock.calls[0]?.[0][0];
    expect(created).toMatchObject({ type: 'item.create', item: { x: 100, y: 70 } });
    expect(clearSelection).toHaveBeenCalledOnce();
    expect(selectItems).toHaveBeenCalledWith([expect.any(String)]);
  });
});
