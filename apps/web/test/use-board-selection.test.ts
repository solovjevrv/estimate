import type { BoardEdge, BoardItem, BoardOp } from '@poker/shared';
import { BOARD_ITEM_FONT_SIZE_MAX, BOARD_ITEM_FONT_SIZE_MIN } from '@poker/shared';
import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { FIT_FONT_MAX } from '../src/lib/board/use-fit-font-size';
import {
  useBoardSelection,
  type BoardSelectionOptions,
} from '../src/features/boards/composables/use-board-selection';
import type { BoardSelectionEdge, BoardSelectionNode } from '../src/lib/board/vue-flow-adapter';

// Тестовые заглушки — плоские (shallow), а не deep GraphNode, чтобы не взрывать типы vue-flow
interface MockNode {
  id: string;
  data: BoardItem;
  position: { x: number; y: number };
  computedPosition: { x: number; y: number; z: number };
  dimensions: { width: number; height: number };
  selected: boolean;
}
interface MockEdge {
  id: string;
  data: BoardEdge;
  source: string;
  target: string;
  selected: boolean;
}

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
    createdBy: null,
    updatedAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  };
}

function flowNode(
  data: BoardItem,
  pos = { x: 0, y: 0 },
  dims = { width: 120, height: 80 },
  selected = false,
): MockNode {
  return {
    id: data.id,
    position: { x: pos.x, y: pos.y },
    computedPosition: { x: pos.x, y: pos.y, z: 0 },
    dimensions: { width: dims.width, height: dims.height },
    selected,
    data,
  };
}

function boardEdge(id: string, overrides: Partial<BoardEdge> = {}): BoardEdge {
  return {
    id,
    boardId: 'board-1',
    sourceItemId: 'src',
    targetItemId: 'tgt',
    sourceHandle: null,
    targetHandle: null,
    label: null,
    style: { line: 'curved', markerStart: 'none', markerEnd: 'arrow' },
    ...overrides,
  };
}

function flowEdge(data: BoardEdge, selected = false): MockEdge {
  return {
    id: data.id,
    source: data.sourceItemId,
    target: data.targetItemId,
    selected,
    data,
  };
}

function defaultTextDims(content: BoardItem['content']): { width: number; height: number } | null {
  switch (content.type) {
    case 'text':
    case 'sticky':
    case 'shape':
      return { width: 120, height: 80 };
    default:
      return null;
  }
}

interface MakeOptions {
  items?: BoardItem[];
  flowNodes?: MockNode[];
  flowEdges?: MockEdge[];
  selectedNodes?: MockNode[];
  selectedEdges?: MockEdge[];
  canEdit?: () => boolean;
  canCreateItem?: () => boolean;
  activeTool?: () => string;
  getBoardZIndex?: () => { max: number; min: number };
  defaultItemColor?: string;
  getViewport?: () => { x: number; y: number; zoom: number };
}

function makeSelection(opts: MakeOptions = {}) {
  const applyOps = vi.fn<(ops: BoardOp[]) => void>();
  const onContainerClick = vi.fn();
  const setPendingEdgeEditId = vi.fn();
  const breakFollowOnEdit = vi.fn();

  const itemsRef = ref(opts.items ?? []);
  const nodesRef = ref<MockNode[]>(opts.flowNodes ?? []);
  const edgesRef = ref<MockEdge[]>(opts.flowEdges ?? []);
  const selectedNodesRef = ref<MockNode[]>(opts.selectedNodes ?? []);
  const selectedEdgesRef = ref<MockEdge[]>(opts.selectedEdges ?? []);

  const api = useBoardSelection({
    canEdit: opts.canEdit ?? (() => true),
    getItems: () => itemsRef.value,
    getEdges: () => edgesRef.value as unknown as BoardSelectionEdge[],
    getNodes: () => nodesRef.value as unknown as BoardSelectionNode[],
    getCanvasRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) as unknown as DOMRect,
    getViewport: opts.getViewport ?? (() => ({ x: 0, y: 0, zoom: 1 })),
    getSelectedNodes: () => selectedNodesRef.value as unknown as BoardSelectionNode[],
    getSelectedEdges: () => selectedEdgesRef.value as unknown as BoardSelectionEdge[],
    applyOps,
    canCreateItem: opts.canCreateItem ?? (() => true),
    onContainerClick,
    pickImageFile: vi.fn(),
    uploadImage: vi.fn(),
    activeTool: opts.activeTool ?? (() => 'select'),
    setPendingEdgeEditId,
    breakFollowOnEdit,
    textDefaultDimensions: (c) => defaultTextDims(c),
    getBoardZIndex: opts.getBoardZIndex ?? (() => ({ max: 10, min: 0 })),
    defaultItemColor: opts.defaultItemColor ?? '#CCCCCC',
    resolveTextColor: () => '#111111',
    resolveEdgeColor: (c) => c ?? '#222222',
  });

  return {
    api,
    applyOps,
    onContainerClick,
    setPendingEdgeEditId,
    breakFollowOnEdit,
    setSelected: (nodes: MockNode[], edges: MockEdge[] = []) => {
      selectedNodesRef.value = nodes;
      selectedEdgesRef.value = edges;
    },
  };
}

// Идиома репо: `applyOps.mock.calls[0][0]` — массив операций в слабо типизированном виде,
// поэтому доступ к `.type/.item/.patch/.id` не требует ручного сужения union BoardOp.
function lastOps(applyOps: ReturnType<typeof vi.fn>): any[] {
  return applyOps.mock.calls[applyOps.mock.calls.length - 1]?.[0] ?? [];
}

// Плоские MockNode/MockEdge не структурно совместимы с deep GraphNode/GraphEdge,
// поэтому узлы/ребра приводятся к рабочим типам только на границе вызовов методов.
const asNode = (n: MockNode) => n as unknown as BoardSelectionNode;
const asEdge = (e: MockEdge) => e as unknown as BoardSelectionEdge;

describe('useBoardSelection — selectedNodes/selectedEdges', () => {
  it('reflects the current selection from options', () => {
    const a = flowNode(item('a'));
    const e = flowEdge(boardEdge('e'));
    const { api } = makeSelection({ selectedNodes: [a], selectedEdges: [e] });
    expect(api.selectedNodes.value).toEqual([a]);
    expect(api.selectedEdges.value).toEqual([e]);
  });
});

describe('useBoardSelection — selectedForm', () => {
  it('derives form from the first selected node content', () => {
    const cases: [BoardItem, string][] = [
      [item('a', { content: { type: 'sticky', text: 'x' } }), 'sticky'],
      [item('b', { content: { type: 'shape', shape: 'diamond', text: 'x' } }), 'diamond'],
      [item('c', { content: { type: 'text', text: 'x' } }), 'text'],
      [item('d', { content: { type: 'image', url: 'u', width: 1, height: 1 } }), 'image'],
      [item('e', { content: { type: 'emoji', emoji: '👍' } }), 'emoji'],
      [item('f', { content: { type: 'sticker', pack: 'p', id: 's' } }), 'sticker'],
      [item('g', { content: { type: 'frame', title: 'F' } }), 'frame'],
      [item('h', { content: { type: 'group' } }), 'group'],
    ];
    for (const [it, form] of cases) {
      const { api } = makeSelection({ selectedNodes: [flowNode(it)] });
      expect(api.selectedForm.value).toBe(form);
    }
  });

  it('falls back to sticky when nothing is selected', () => {
    const { api } = makeSelection({ selectedNodes: [] });
    expect(api.selectedForm.value).toBe('sticky');
  });
});

describe('useBoardSelection — selectedColor', () => {
  it('returns the item color of the first selected node', () => {
    const a = flowNode(item('a', { style: { color: '#FF0000' } }));
    const { api } = makeSelection({ selectedNodes: [a] });
    expect(api.selectedColor.value).toBe('#FF0000');
  });

  it('falls back to defaultItemColor when no node is selected', () => {
    const { api } = makeSelection({ selectedNodes: [], defaultItemColor: '#ABCDEF' });
    expect(api.selectedColor.value).toBe('#ABCDEF');
  });
});

describe('useBoardSelection — selectedEdgeStyle/Color', () => {
  it('returns a safe default when no edge is selected', () => {
    const { api } = makeSelection({ selectedEdges: [] });
    expect(api.selectedEdgeStyle.value).toEqual({
      line: 'curved',
      markerStart: 'none',
      markerEnd: 'arrow',
    });
  });

  it('reads style from the first selected edge and resolves its color', () => {
    const e = flowEdge(
      boardEdge('e', {
        style: { line: 'straight', markerStart: 'dot', markerEnd: 'arrow', color: '#FF0000' },
      }),
    );
    const { api } = makeSelection({ selectedEdges: [e] });
    expect(api.selectedEdgeStyle.value.color).toBe('#FF0000');
    expect(api.selectedEdgeColor.value).toBe('#FF0000');
  });
});

describe('useBoardSelection — grouping flags', () => {
  it('canGroup: 2+ non-container nodes', () => {
    const a = flowNode(item('a'));
    const b = flowNode(item('b'));
    const frame = flowNode(item('f', { content: { type: 'frame', title: 'F' } }));

    expect(makeSelection({ selectedNodes: [a] }).api.canGroupSelection.value).toBe(false);
    expect(makeSelection({ selectedNodes: [a, b] }).api.canGroupSelection.value).toBe(true);
    expect(makeSelection({ selectedNodes: [a, frame] }).api.canGroupSelection.value).toBe(false);
  });

  it('canUngroup: any selected node has a parent', () => {
    const orphan = flowNode(item('a'));
    const child = flowNode(item('b', { parentId: 'g' }));

    expect(makeSelection({ selectedNodes: [orphan] }).api.canUngroupSelection.value).toBe(false);
    expect(makeSelection({ selectedNodes: [child] }).api.canUngroupSelection.value).toBe(true);
  });
});

describe('useBoardSelection — groupSelection', () => {
  it('creates a group, reparents selected nodes into it and stacks above max', () => {
    const a = flowNode(item('a'), { x: 0, y: 0 }, { width: 100, height: 100 });
    const b = flowNode(item('b'), { x: 50, y: 50 }, { width: 100, height: 100 });
    const { api, applyOps } = makeSelection({
      selectedNodes: [a, b],
      items: [item('a'), item('b')],
      getBoardZIndex: () => ({ max: 5, min: 0 }),
      defaultItemColor: '#ABCABC',
    });

    api.groupSelection();

    const ops = lastOps(applyOps);
    const create = ops.find((op) => op.type === 'item.create');
    expect(create).toBeDefined();
    expect(create.item.content).toEqual({ type: 'group' });
    expect(create.item.zIndex).toBe(6);
    expect(create.item.style).toEqual({ color: '#ABCABC' });

    const reparents = ops.filter((op) => op.type === 'item.patch');
    expect(reparents.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(reparents.every((p) => p.patch.parentId === create.item.id)).toBe(true);
  });

  it('no-op when grouping is not allowed', () => {
    const a = flowNode(item('a'));
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.groupSelection();
    expect(applyOps).not.toHaveBeenCalled();
  });
});

describe('useBoardSelection — ungroupSelection', () => {
  it('dissolves a group: reparents members and deletes the group', () => {
    const group = item('g', { content: { type: 'group' } });
    const member = item('m', { parentId: 'g' });
    const { api, applyOps } = makeSelection({
      selectedNodes: [flowNode(member)],
      items: [group, member],
    });

    api.ungroupSelection();
    const ops = lastOps(applyOps);
    expect(
      ops.some((op) => op.type === 'item.patch' && op.id === 'm' && op.patch.parentId === null),
    ).toBe(true);
    expect(ops.some((op) => op.type === 'item.delete' && op.id === 'g')).toBe(true);
  });

  it('for a frame parent: reparents the child but does NOT delete the frame', () => {
    const frame = item('fr', { content: { type: 'frame', title: 'F' } });
    const member = item('m', { parentId: 'fr' });
    const { api, applyOps } = makeSelection({
      selectedNodes: [flowNode(member)],
      items: [frame, member],
    });

    api.ungroupSelection();
    const ops = lastOps(applyOps);
    expect(
      ops.some((op) => op.type === 'item.patch' && op.id === 'm' && op.patch.parentId === null),
    ).toBe(true);
    expect(ops.some((op) => op.type === 'item.delete')).toBe(false);
  });
});

describe('useBoardSelection — setSelectedForm', () => {
  it('ignores conversions to image/emoji/sticker/frame/group', () => {
    const a = flowNode(item('a', { content: { type: 'sticky', text: 'x' } }));
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });

    api.setSelectedForm('image');
    api.setSelectedForm('emoji');
    api.setSelectedForm('sticker');
    api.setSelectedForm('frame');
    api.setSelectedForm('group');
    expect(applyOps).not.toHaveBeenCalled();
  });

  it('converts sticky text content to text', () => {
    const { api, applyOps } = makeSelection({
      selectedNodes: [flowNode(item('a', { content: { type: 'sticky', text: 'hello' } }))],
    });
    api.setSelectedForm('text');
    const op = lastOps(applyOps)[0];
    expect(op.type).toBe('item.patch');
    expect(op.patch.content).toEqual({ type: 'text', text: 'hello' });
  });

  it('converts sticky text content to a shape, preserving text', () => {
    const { api, applyOps } = makeSelection({
      selectedNodes: [flowNode(item('a', { content: { type: 'sticky', text: 'hello' } }))],
    });
    api.setSelectedForm('rectangle');
    const op = lastOps(applyOps)[0];
    expect(op.patch.content).toEqual({ type: 'shape', shape: 'rectangle', text: 'hello' });
  });

  it('squares geometry when converting to sticky', () => {
    const a = flowNode(
      item('a', { content: { type: 'text', text: 'x' } }),
      { x: 10, y: 20 },
      { width: 200, height: 100 },
    );
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedForm('sticky');
    const op = lastOps(applyOps)[0];
    const side = 100;
    expect(op.patch).toMatchObject({
      x: 10 + (200 - side) / 2,
      y: 20 + (100 - side) / 2,
      width: side,
      height: side,
    });
  });
});

describe('useBoardSelection — setSelectedColor', () => {
  it('patches the zalyvka color of all selected nodes', () => {
    const a = flowNode(item('a'));
    const b = flowNode(item('b'));
    const { api, applyOps } = makeSelection({ selectedNodes: [a, b] });
    api.setSelectedColor('#123456');
    const ops = lastOps(applyOps);
    expect(ops).toHaveLength(2);
    expect(ops.every((op) => op.type === 'item.patch' && op.patch.style.color === '#123456')).toBe(
      true,
    );
  });
});

describe('useBoardSelection — color preview session (the bug fix)', () => {
  it('cancel reverts the FROZEN ids even after selection is cleared', () => {
    const a = flowNode(item('a', { style: { color: '#orig' } }));
    const { api, applyOps, setSelected } = makeSelection({
      selectedNodes: [a],
      defaultItemColor: '#CCCCCC',
    });

    api.previewSelectedColor('#preview');
    expect(applyOps).toHaveBeenCalledTimes(1);
    const previewOps = lastOps(applyOps);
    expect(previewOps).toEqual([
      expect.objectContaining({
        type: 'item.patch',
        id: 'a',
        patch: { style: { color: '#preview' } },
      }),
    ]);

    // Клик мимо объекта синхронно снимает выделение — имитируем "до" эмита отмены
    setSelected([]);

    api.cancelSelectedColorPreview('#CCCCCC');
    expect(applyOps).toHaveBeenCalledTimes(2);
    const cancelOps = lastOps(applyOps);
    // ids are frozen at session start, so 'a' is reverted even though selection is empty
    expect(cancelOps.map((op: any) => op.id)).toEqual(['a']);
    expect(cancelOps[0]!.patch.style.color).toBe('#CCCCCC');
  });

  it('second preview without a commit does not re-freeze ids', () => {
    const a = flowNode(item('a', { style: { color: '#orig' } }));
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.previewSelectedColor('#one');
    api.previewSelectedColor('#two'); // ids already frozen → only color updates
    expect(applyOps).toHaveBeenCalledTimes(2);
    expect(lastOps(applyOps)[0]!.patch.style.color).toBe('#two');
  });
});

describe('useBoardSelection — font size clamping', () => {
  it('canIncrease/canDecrease respect FONT_SIZE bounds', () => {
    const hi = flowNode(
      item('a', {
        content: { type: 'frame', title: 'F' },
        style: { color: '#fff', fontSize: BOARD_ITEM_FONT_SIZE_MAX },
      }),
    );
    const lo = flowNode(
      item('b', {
        content: { type: 'frame', title: 'F' },
        style: { color: '#fff', fontSize: BOARD_ITEM_FONT_SIZE_MIN },
      }),
    );

    expect(makeSelection({ selectedNodes: [hi] }).api.canIncreaseSelectedFontSize.value).toBe(
      false,
    );
    expect(makeSelection({ selectedNodes: [hi] }).api.canDecreaseSelectedFontSize.value).toBe(true);
    expect(makeSelection({ selectedNodes: [lo] }).api.canDecreaseSelectedFontSize.value).toBe(
      false,
    );
    expect(makeSelection({ selectedNodes: [lo] }).api.canIncreaseSelectedFontSize.value).toBe(true);
  });

  it('selectedFontSize falls back to FIT_FONT_MAX when no base size is set', () => {
    const a = flowNode(item('a', { content: { type: 'frame', title: 'F' } }));
    const { api } = makeSelection({ selectedNodes: [a] });
    expect(api.selectedFontSize.value).toBe(FIT_FONT_MAX);
  });

  it('setSelectedFontSize clamps to MAX and patches the base size', () => {
    const a = flowNode(
      item('a', { content: { type: 'frame', title: 'F' }, style: { color: '#fff', fontSize: 20 } }),
    );
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedFontSize(BOARD_ITEM_FONT_SIZE_MAX + 100);
    const op = lastOps(applyOps)[0];
    expect(op.patch.style.fontSize).toBe(BOARD_ITEM_FONT_SIZE_MAX);
  });

  it('setSelectedFontSize is a no-op once already at MAX (clampedBase === currentBase)', () => {
    const a = flowNode(
      item('a', {
        content: { type: 'frame', title: 'F' },
        style: { color: '#fff', fontSize: BOARD_ITEM_FONT_SIZE_MAX },
      }),
    );
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedFontSize(BOARD_ITEM_FONT_SIZE_MAX + 100);
    expect(applyOps).not.toHaveBeenCalled();
  });
});

describe('useBoardSelection — text style setters', () => {
  it('setSelectedTextColor patches textColor', () => {
    const a = flowNode(item('a', { style: { color: '#fff' } }));
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedTextColor('#999999');
    expect(lastOps(applyOps)[0]!.patch.style.textColor).toBe('#999999');
  });

  it('setSelectedTextAlign patches textAlign', () => {
    const a = flowNode(item('a'));
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedTextAlign('right');
    expect(lastOps(applyOps)[0]!.patch.style.textAlign).toBe('right');
  });
});

describe('useBoardSelection — emoji/sticker/image', () => {
  it('setSelectedEmoji only patches emoji nodes', () => {
    const emoji = flowNode(item('e1', { content: { type: 'emoji', emoji: '👍' } }));
    const sticky = flowNode(item('s1'));
    const { api, applyOps } = makeSelection({ selectedNodes: [emoji, sticky] });
    api.setSelectedEmoji('🔥');
    const ops = lastOps(applyOps);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe('e1');
    expect(ops[0]!.patch.content).toEqual({ type: 'emoji', emoji: '🔥' });
  });

  it('setSelectedSticker only patches sticker nodes', () => {
    const sticker = flowNode(item('s1', { content: { type: 'sticker', pack: 'p', id: 'i' } }));
    const { api, applyOps } = makeSelection({ selectedNodes: [sticker] });
    api.setSelectedSticker('pack2', 'id2');
    expect(lastOps(applyOps)[0]!.patch.content).toEqual({
      type: 'sticker',
      pack: 'pack2',
      id: 'id2',
    });
  });
});

describe('useBoardSelection — edge text edit', () => {
  it('addTextToSelectedEdge forwards the edge id to the editor', () => {
    const e = flowEdge(boardEdge('edge-1'));
    const { api, setPendingEdgeEditId } = makeSelection({ selectedEdges: [e] });
    api.addTextToSelectedEdge();
    expect(setPendingEdgeEditId).toHaveBeenCalledWith('edge-1');
  });

  it('addTextToSelectedEdge is a no-op without a selected edge', () => {
    const { api, setPendingEdgeEditId } = makeSelection({ selectedEdges: [] });
    api.addTextToSelectedEdge();
    expect(setPendingEdgeEditId).not.toHaveBeenCalled();
  });
});

describe('useBoardSelection — layer ops', () => {
  it('bringSelectedToFront stacks above current max (max+1, max+2, ...)', () => {
    const a = flowNode(item('a'));
    const b = flowNode(item('b'));
    const { api, applyOps } = makeSelection({
      selectedNodes: [a, b],
      getBoardZIndex: () => ({ max: 10, min: 0 }),
    });
    api.bringSelectedToFront();
    const ops = lastOps(applyOps);
    expect(ops.map((op: any) => op.patch.zIndex).sort((x: number, y: number) => x - y)).toEqual([
      11, 12,
    ]);
  });

  it('sendSelectedToBack stacks below current min', () => {
    const a = flowNode(item('a'));
    const b = flowNode(item('b'));
    const { api, applyOps } = makeSelection({
      selectedNodes: [a, b],
      getBoardZIndex: () => ({ max: 10, min: 0 }),
    });
    api.sendSelectedToBack();
    const ops = lastOps(applyOps);
    expect(ops.map((op: any) => op.patch.zIndex).sort((x: number, y: number) => x - y)).toEqual([
      -2, -1,
    ]);
  });
});

describe('useBoardSelection — delete ops', () => {
  it('deleteSelected emits item.delete for each selected node', () => {
    const { api, applyOps } = makeSelection({
      selectedNodes: [flowNode(item('a')), flowNode(item('b'))],
    });
    api.deleteSelected();
    const ops = lastOps(applyOps);
    expect(ops.map((op: any) => op.type)).toEqual(['item.delete', 'item.delete']);
    expect(ops.map((op: any) => op.id).sort()).toEqual(['a', 'b']);
  });

  it('deleteSelectedEdges emits edge.delete for each selected edge', () => {
    const { api, applyOps } = makeSelection({
      selectedEdges: [flowEdge(boardEdge('e1')), flowEdge(boardEdge('e2'))],
    });
    api.deleteSelectedEdges();
    const ops = lastOps(applyOps);
    expect(ops.map((op: any) => op.type)).toEqual(['edge.delete', 'edge.delete']);
  });
});

describe('useBoardSelection — selection toggle', () => {
  it('selectOnlyNode selects only the target', () => {
    const a = flowNode(item('a'), { x: 0, y: 0 }, { width: 10, height: 10 }, false);
    const b = flowNode(item('b'), { x: 0, y: 0 }, { width: 10, height: 10 }, true);
    const { api } = makeSelection({ flowNodes: [a, b] });
    api.selectOnlyNode(asNode(a));
    expect(a.selected).toBe(true);
    expect(b.selected).toBe(false);
  });

  it('selectOnlyEdge selects only the target edge', () => {
    const e1 = flowEdge(boardEdge('e1'), true);
    const e2 = flowEdge(boardEdge('e2'), true);
    const { api } = makeSelection({ flowEdges: [e1, e2] });
    api.selectOnlyEdge(asEdge(e2));
    expect(e1.selected).toBe(false);
    expect(e2.selected).toBe(true);
  });

  it('selectAllElements selects every node and edge', () => {
    const n = flowNode(item('n'), { x: 0, y: 0 }, { width: 10, height: 10 }, false);
    const e = flowEdge(boardEdge('e'), false);
    const { api } = makeSelection({ flowNodes: [n], flowEdges: [e] });
    api.selectAllElements();
    expect(n.selected).toBe(true);
    expect(e.selected).toBe(true);
  });

  it('clearAllSelection deselects everything', () => {
    const n = flowNode(item('n'), { x: 0, y: 0 }, { width: 10, height: 10 }, true);
    const e = flowEdge(boardEdge('e'), true);
    const { api } = makeSelection({ flowNodes: [n], flowEdges: [e] });
    api.clearAllSelection();
    expect(n.selected).toBe(false);
    expect(e.selected).toBe(false);
  });
});

describe('useBoardSelection — toolbar positions', () => {
  it('selectionToolbarPosition projects the bounding box via viewport', () => {
    const a = flowNode(item('a'), { x: 10, y: 20 }, { width: 100, height: 100 });
    const b = flowNode(item('b'), { x: 50, y: 60 }, { width: 100, height: 100 });
    const { api } = makeSelection({
      selectedNodes: [a, b],
      getViewport: () => ({ x: 100, y: 200, zoom: 2 }),
    });
    const pos = api.selectionToolbarPosition.value!;
    // left=min(10,50)=10, right=max(110,150)=150, center=80; 100 + 80*2 = 260
    expect(pos.left).toBe(260);
    expect(pos.top).toBe(240); // 200 + min(20,60)*2 = 200 + 40
  });

  it('selectionToolbarPosition is null with no selection or no edit access', () => {
    const a = flowNode(item('a'));
    expect(makeSelection({ selectedNodes: [] }).api.selectionToolbarPosition.value).toBeNull();
    expect(
      makeSelection({ selectedNodes: [a], canEdit: () => false }).api.selectionToolbarPosition
        .value,
    ).toBeNull();
  });

  it('edgeToolbarPosition projects the midpoint between source and target', () => {
    const src = flowNode(item('s'), { x: 0, y: 0 }, { width: 100, height: 100 });
    const tgt = flowNode(item('t'), { x: 200, y: 100 }, { width: 100, height: 100 });
    const e = flowEdge(boardEdge('e', { sourceItemId: 's', targetItemId: 't' }));
    const { api } = makeSelection({
      selectedEdges: [e],
      flowNodes: [src, tgt],
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    });
    const pos = api.edgeToolbarPosition.value!;
    expect(pos.left).toBe(100); // (0 + 200) / 2
    expect(pos.top).toBe(50); // (0 + 100) / 2
  });

  it('edgeToolbarPosition is null when source/target nodes are missing', () => {
    const e = flowEdge(boardEdge('e', { sourceItemId: 'missing', targetItemId: 'also' }));
    const { api } = makeSelection({ selectedEdges: [e], flowNodes: [] });
    expect(api.edgeToolbarPosition.value).toBeNull();
  });
});

describe('useBoardSelection — node click delegation', () => {
  it('delegates a mouse click on a container to onContainerClick when not in select mode', () => {
    const frame = flowNode(item('f', { content: { type: 'frame', title: 'F' } }));
    const { api, onContainerClick } = makeSelection({
      flowNodes: [frame],
      activeTool: () => 'sticky',
    });
    api.onNodeClick({ event: new MouseEvent('click'), node: asNode(frame) });
    expect(onContainerClick).toHaveBeenCalledWith(expect.any(MouseEvent));
  });

  it('ignores touch events (only mouse creates a new element)', () => {
    const frame = flowNode(item('f', { content: { type: 'frame', title: 'F' } }));
    const { api, onContainerClick } = makeSelection({
      flowNodes: [frame],
      activeTool: () => 'sticky',
    });
    api.onNodeClick({
      event: new Event('touchstart') as unknown as TouchEvent,
      node: asNode(frame),
    });
    expect(onContainerClick).not.toHaveBeenCalled();
  });

  it('is a no-op in select tool (Vue Flow handles picking)', () => {
    const frame = flowNode(item('f', { content: { type: 'frame', title: 'F' } }));
    const { api, onContainerClick } = makeSelection({
      flowNodes: [frame],
      activeTool: () => 'select',
    });
    api.onNodeClick({ event: new MouseEvent('click'), node: asNode(frame) });
    expect(onContainerClick).not.toHaveBeenCalled();
  });

  it('ignores non-container nodes', () => {
    const sticky = flowNode(item('s', { content: { type: 'sticky', text: 'x' } }));
    const { api, onContainerClick } = makeSelection({
      flowNodes: [sticky],
      activeTool: () => 'sticker',
    });
    api.onNodeClick({ event: new MouseEvent('click'), node: asNode(sticky) });
    expect(onContainerClick).not.toHaveBeenCalled();
  });
});

describe('useBoardSelection — context menu', () => {
  it('onNodeContextMenu opens the item menu and selects the node if unselected', () => {
    const a = flowNode(item('a'), { x: 0, y: 0 }, { width: 10, height: 10 }, false);
    const { api } = makeSelection({ selectedNodes: [], flowNodes: [a] });
    api.onNodeContextMenu({ event: new MouseEvent('contextmenu'), node: asNode(a) });
    expect(a.selected).toBe(true);
    expect(api.contextMenu.value).toMatchObject({ target: 'item' });
  });

  it('onNodeContextMenu is a no-op without edit access', () => {
    const a = flowNode(item('a'));
    const { api } = makeSelection({ selectedNodes: [], flowNodes: [a], canEdit: () => false });
    api.onNodeContextMenu({ event: new MouseEvent('contextmenu'), node: asNode(a) });
    expect(api.contextMenu.value).toBeNull();
  });

  it('onEdgeContextMenu opens the edge menu', () => {
    const e = flowEdge(boardEdge('e', { sourceItemId: 's', targetItemId: 't' }), false);
    const { api } = makeSelection({ selectedEdges: [], flowEdges: [e] });
    api.onEdgeContextMenu({ event: new MouseEvent('contextmenu'), edge: asEdge(e) });
    expect(e.selected).toBe(true);
    expect(api.contextMenu.value).toMatchObject({ target: 'edge' });
  });

  it('onPaneContextMenu and closeContextMenu clear the menu', () => {
    const a = flowNode(item('a'));
    const { api } = makeSelection({ selectedNodes: [a] });
    api.onNodeContextMenu({ event: new MouseEvent('contextmenu'), node: asNode(a) });
    expect(api.contextMenu.value).not.toBeNull();
    api.onPaneContextMenu(new MouseEvent('contextmenu'));
    expect(api.contextMenu.value).toBeNull();
    api.onNodeContextMenu({ event: new MouseEvent('contextmenu'), node: asNode(a) });
    expect(api.contextMenu.value).not.toBeNull();
    api.closeContextMenu();
    expect(api.contextMenu.value).toBeNull();
  });
});

describe('useBoardSelection — edge style ops', () => {
  it('patchEdgeLine emits edge.patch with the new line kind', () => {
    const e = flowEdge(boardEdge('e'));
    const { api, applyOps } = makeSelection({ selectedEdges: [e] });
    api.patchEdgeLine('orthogonal');
    const op = lastOps(applyOps)[0];
    expect(op.type).toBe('edge.patch');
    expect(op.patch.style.line).toBe('orthogonal');
  });

  it('patchEdgeColor emits edge.patch with the new color', () => {
    const e = flowEdge(boardEdge('e'));
    const { api, applyOps } = makeSelection({ selectedEdges: [e] });
    api.patchEdgeColor('#AABBCC');
    expect(lastOps(applyOps)[0]!.patch.style.color).toBe('#AABBCC');
  });

  it('previewEdgeColor overrides only the color, preserving the rest of the style', () => {
    const e = flowEdge(
      boardEdge('e', {
        style: { line: 'curved', markerStart: 'dot', markerEnd: 'arrow', color: '#orig' },
      }),
    );
    const { api, applyOps } = makeSelection({ selectedEdges: [e], flowEdges: [e] });
    api.previewEdgeColor('#new');
    expect(lastOps(applyOps)[0]!.patch.style).toEqual({
      line: 'curved',
      markerStart: 'dot',
      markerEnd: 'arrow',
      color: '#new',
    });
  });
});
