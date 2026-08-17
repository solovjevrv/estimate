import type { BoardColorHex, BoardEdge, BoardEdgeStyle, BoardOp } from '@poker/shared';
import { ref } from 'vue';
import { describe, it, expect, vi } from 'vitest';

import { useBoardEdges } from '../src/features/boards/composables/use-board-edges';
import type { BoardFlowEdge, BoardFlowNode } from '../src/lib/board/vue-flow-adapter';

interface MockNode {
  id: string;
  data: BoardFlowNode['data'];
  position: { x: number; y: number };
  dimensions: { width: number; height: number };
  selected: boolean;
  source?: string;
  target?: string;
}

interface MockEdge {
  id: string;
  data: BoardEdge;
  source: string;
  target: string;
  selected: boolean;
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

function flowNode(id: string, x = 0, y = 0): MockNode {
  return {
    id,
    position: { x, y },
    dimensions: { width: 100, height: 100 },
    selected: false,
    data: {} as BoardFlowNode['data'],
  };
}

function makeEdges(
  opts: {
    selectedEdges?: MockEdge[];
    flowNodes?: MockNode[];
    flowEdges?: MockEdge[];
    canEdit?: () => boolean;
    activeTool?: () => string;
    getViewport?: () => { x: number; y: number; zoom: number };
    resolveEdgeColor?: (color: BoardColorHex | undefined) => BoardColorHex;
  } = {},
) {
  const applyOps = vi.fn<(ops: BoardOp[]) => void>();
  const breakFollowOnEdit = vi.fn();

  const nodesRef = ref<MockNode[]>(opts.flowNodes ?? []);
  const edgesRef = ref<MockEdge[]>(opts.flowEdges ?? []);
  const selectedEdgesRef = ref<MockEdge[]>(opts.selectedEdges ?? []);

  const edges = useBoardEdges({
    canEdit: opts.canEdit ?? (() => true),
    getNodes: () => nodesRef.value as unknown as BoardFlowNode[],
    getEdges: () => edgesRef.value as unknown as BoardFlowEdge[],
    getSelectedEdges: () => selectedEdgesRef.value as unknown as BoardFlowEdge[],
    getViewport: opts.getViewport ?? (() => ({ x: 0, y: 0, zoom: 1 })),
    applyOps,
    activeTool: opts.activeTool ?? (() => 'select'),
    setActiveTool: vi.fn(),
    resolveEdgeColor: opts.resolveEdgeColor ?? ((c) => c ?? '#222222'),
    breakFollowOnEdit,
  });

  return {
    edges,
    applyOps,
    breakFollowOnEdit,
    setSelected: (edges: MockEdge[]) => {
      selectedEdgesRef.value = edges;
    },
    setFlowEdges: (edges: MockEdge[]) => {
      edgesRef.value = edges;
    },
    setFlowNodes: (nodes: MockNode[]) => {
      nodesRef.value = nodes;
    },
  };
}

type InspectedBoardOp = {
  type: BoardOp['type'];
  id: string;
  edge: {
    sourceItemId: string;
    targetItemId: string;
    sourceHandle: string | null;
    targetHandle: string | null;
    label: string | null;
    style: BoardEdgeStyle;
  };
  patch: { style: BoardEdgeStyle };
};

function lastOps(applyOps: ReturnType<typeof vi.fn>): InspectedBoardOp[] {
  return (applyOps.mock.calls[applyOps.mock.calls.length - 1]?.[0] ?? []) as InspectedBoardOp[];
}

describe('useBoardEdges — onConnect', () => {
  it('creates an edge.create op from a valid connection and resets arrow tool', () => {
    const { edges, applyOps, breakFollowOnEdit } = makeEdges({
      activeTool: () => 'arrow',
      canEdit: () => true,
    });

    edges.onConnect({
      source: 's1',
      target: 't1',
      sourceHandle: 'right',
      targetHandle: 'left',
    });

    expect(breakFollowOnEdit).toHaveBeenCalled();
    const ops = lastOps(applyOps);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('edge.create');
    expect(ops[0]!.edge.sourceItemId).toBe('s1');
    expect(ops[0]!.edge.targetItemId).toBe('t1');
    expect(ops[0]!.edge.sourceHandle).toBe('right');
    expect(ops[0]!.edge.targetHandle).toBe('left');
    expect(ops[0]!.edge.style).toEqual({
      line: 'curved',
      markerStart: 'none',
      markerEnd: 'arrow',
    });
  });

  it('is a no-op when not in edit mode', () => {
    const { edges, applyOps } = makeEdges({ canEdit: () => false });
    edges.onConnect({ source: 's1', target: 't1', sourceHandle: null, targetHandle: null });
    expect(applyOps).not.toHaveBeenCalled();
  });

  it('ignores connections with null source or target', () => {
    const { edges, applyOps } = makeEdges();
    edges.onConnect({ source: null, target: null, sourceHandle: null, targetHandle: null });
    expect(applyOps).not.toHaveBeenCalled();
  });
});

describe('useBoardEdges — onEdgeDoubleClick', () => {
  it('sets pendingEdgeEditId for the clicked edge', () => {
    const e = flowEdge(boardEdge('edge-1'));
    const { edges, setSelected } = makeEdges({ selectedEdges: [] });
    setSelected([e]);

    edges.onEdgeDoubleClick({ edge: { id: 'edge-1' } });

    expect(edges.pendingEdgeEditId.value).toBe('edge-1');
  });

  it('is a no-op without edit access', () => {
    const { edges, setSelected } = makeEdges({ canEdit: () => false });
    setSelected([flowEdge(boardEdge('e'))]);

    edges.onEdgeDoubleClick({ edge: { id: 'e' } });

    expect(edges.pendingEdgeEditId.value).toBeNull();
  });
});

describe('useBoardEdges — addTextToSelectedEdge', () => {
  it('sets pendingEdgeEditId for the first selected edge', () => {
    const e = flowEdge(boardEdge('edge-1'));
    const { edges } = makeEdges({ selectedEdges: [e] });
    edges.addTextToSelectedEdge();
    expect(edges.pendingEdgeEditId.value).toBe('edge-1');
  });

  it('is a no-op without a selected edge', () => {
    const { edges } = makeEdges({ selectedEdges: [] });
    edges.addTextToSelectedEdge();
    expect(edges.pendingEdgeEditId.value).toBeNull();
  });

  it('is a no-op without edit access', () => {
    const e = flowEdge(boardEdge('e'));
    const { edges } = makeEdges({ selectedEdges: [e], canEdit: () => false });
    edges.addTextToSelectedEdge();
    expect(edges.pendingEdgeEditId.value).toBeNull();
  });
});

describe('useBoardEdges — deleteSelectedEdges', () => {
  it('emits edge.delete for each selected edge', () => {
    const { edges, applyOps } = makeEdges({
      selectedEdges: [flowEdge(boardEdge('e1')), flowEdge(boardEdge('e2'))],
    });

    edges.deleteSelectedEdges();

    const ops = lastOps(applyOps);
    expect(ops.map((op) => op.type)).toEqual(['edge.delete', 'edge.delete']);
    expect(ops.map((op) => op.id).sort()).toEqual(['e1', 'e2']);
  });

  it('is a no-op without edit access', () => {
    const { edges, applyOps } = makeEdges({
      selectedEdges: [flowEdge(boardEdge('e1')), flowEdge(boardEdge('e2'))],
      canEdit: () => false,
    });

    edges.deleteSelectedEdges();

    expect(applyOps).not.toHaveBeenCalled();
  });
});

describe('useBoardEdges — edgeToolbarPosition', () => {
  it('projects the midpoint between source and target nodes via viewport', () => {
    const src = flowNode('s', 0, 0);
    const tgt = flowNode('t', 200, 100);
    const e = flowEdge(boardEdge('e', { sourceItemId: 's', targetItemId: 't' }));

    const { edges, setFlowNodes, setSelected } = makeEdges({
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    });

    setFlowNodes([src, tgt]);
    setSelected([e]);

    const pos = edges.edgeToolbarPosition.value!;
    expect(pos.left).toBe(100); // (0 + 200) / 2
    expect(pos.top).toBe(50); // (0 + 100) / 2
  });

  it('is null when no edge is selected', () => {
    const { edges, setSelected } = makeEdges();
    setSelected([]);
    expect(edges.edgeToolbarPosition.value).toBeNull();
  });

  it('is null when source/target nodes are missing', () => {
    const e = flowEdge(boardEdge('e', { sourceItemId: 'missing', targetItemId: 'also' }));
    const { edges, setSelected } = makeEdges({
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    });
    setSelected([e]);
    expect(edges.edgeToolbarPosition.value).toBeNull();
  });

  it('is null without edit access', () => {
    const src = flowNode('s', 0, 0);
    const tgt = flowNode('t', 200, 100);
    const e = flowEdge(boardEdge('e', { sourceItemId: 's', targetItemId: 't' }));

    const { edges, setFlowNodes, setSelected } = makeEdges({
      canEdit: () => false,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    });

    setFlowNodes([src, tgt]);
    setSelected([e]);

    expect(edges.edgeToolbarPosition.value).toBeNull();
  });
});

describe('useBoardEdges — selectedEdgeStyle/Color', () => {
  it('returns a safe default when no edge is selected', () => {
    const { edges, setSelected } = makeEdges({
      resolveEdgeColor: (c) => c ?? '#222222',
    });
    setSelected([]);
    expect(edges.selectedEdgeStyle.value).toEqual({
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
    const { edges } = makeEdges({
      selectedEdges: [e],
      resolveEdgeColor: (c) => c ?? '#222222',
    });
    expect(edges.selectedEdgeStyle.value.color).toBe('#FF0000');
    expect(edges.selectedEdgeColor.value).toBe('#FF0000');
  });

  it('resolves undefined color via resolveEdgeColor', () => {
    const e = flowEdge(boardEdge('e')); // no explicit color → undefined
    const { edges } = makeEdges({
      selectedEdges: [e],
      resolveEdgeColor: (c) => c ?? '#222222',
    });
    expect(edges.selectedEdgeColor.value).toBe('#222222');
  });
});

describe('useBoardEdges — edge style patch ops', () => {
  it('patchEdgeLine emits edge.patch with the new line kind', () => {
    const e = flowEdge(boardEdge('e'));
    const { edges, applyOps } = makeEdges({ selectedEdges: [e] });
    edges.patchEdgeLine('orthogonal');
    const op = lastOps(applyOps)[0]!;
    expect(op.type).toBe('edge.patch');
    expect(op.patch.style.line).toBe('orthogonal');
  });

  it('patchEdgeMarkerStart emits edge.patch with the new marker', () => {
    const e = flowEdge(boardEdge('e'));
    const { edges, applyOps } = makeEdges({ selectedEdges: [e] });
    edges.patchEdgeMarkerStart('dot');
    expect(lastOps(applyOps)[0]!.patch.style.markerStart).toBe('dot');
  });

  it('patchEdgeMarkerEnd emits edge.patch with the new marker', () => {
    const e = flowEdge(boardEdge('e'));
    const { edges, applyOps } = makeEdges({ selectedEdges: [e] });
    edges.patchEdgeMarkerEnd('arrow');
    expect(lastOps(applyOps)[0]!.patch.style.markerEnd).toBe('arrow');
  });

  it('patchEdgeColor emits edge.patch with the new color and ends preview session', () => {
    const e = flowEdge(
      boardEdge('e', {
        style: { line: 'curved', markerStart: 'none', markerEnd: 'arrow', color: '#orig' },
      }),
    );
    const { edges, applyOps } = makeEdges({ selectedEdges: [e] });
    edges.previewEdgeColor('#preview');
    edges.patchEdgeColor('#AABBCC');
    expect(lastOps(applyOps)[0]!.patch.style.color).toBe('#AABBCC');
  });

  it('previewEdgeColor overrides only the color, preserving the rest of the style', () => {
    const e = flowEdge(
      boardEdge('e', {
        style: { line: 'curved', markerStart: 'dot', markerEnd: 'arrow', color: '#orig' },
      }),
    );
    const { edges, applyOps, setSelected, setFlowEdges } = makeEdges();
    setFlowEdges([e]);
    setSelected([e]);

    edges.previewEdgeColor('#new');
    expect(lastOps(applyOps)[0]!.patch.style).toEqual({
      line: 'curved',
      markerStart: 'dot',
      markerEnd: 'arrow',
      color: '#new',
    });
  });

  it('second preview without a commit does not re-freeze ids', () => {
    const e = flowEdge(
      boardEdge('e', {
        style: { line: 'curved', markerStart: 'none', markerEnd: 'arrow', color: '#orig' },
      }),
    );
    const { edges, applyOps, setSelected, setFlowEdges } = makeEdges();
    setFlowEdges([e]);
    setSelected([e]);

    edges.previewEdgeColor('#one');
    expect(lastOps(applyOps)[0]!.patch.style.color).toBe('#one');

    edges.previewEdgeColor('#two');
    expect(lastOps(applyOps)[0]!.patch.style.color).toBe('#two');
  });

  it('cancelEdgeColorPreview reverts the previewed edge ids to the picker original color', () => {
    const e = flowEdge(
      boardEdge('e', {
        style: { line: 'curved', markerStart: 'none', markerEnd: 'arrow', color: '#orig' },
      }),
    );
    const { edges, applyOps, setSelected, setFlowEdges } = makeEdges();
    setFlowEdges([e]);
    setSelected([e]);

    edges.previewEdgeColor('#preview');
    edges.cancelEdgeColorPreview('#orig');

    expect(lastOps(applyOps)[0]!.patch.style.color).toBe('#orig');
  });
});
