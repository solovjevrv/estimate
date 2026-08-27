import type { BoardEdge, BoardItem, BoardOp, BoardItemStyle } from '@poker/shared';
import { BOARD_ITEM_FONT_SIZE_MAX, BOARD_ITEM_FONT_SIZE_MIN } from '@poker/shared';
import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { FIT_FONT_MAX } from '../src/features/boards/composables/use-fit-font-size';
import { useBoardSelection } from '../src/features/boards/composables/use-board-selection';
import type {
  BoardSelectionEdge,
  BoardSelectionNode,
} from '../src/features/boards/adapters/vue-flow-adapter';

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
    style: { line: 'curved', dash: 'solid', markerStart: 'none', markerEnd: 'arrow' },
    zIndex: 1,
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
    breakFollowOnEdit,
    getBoardZIndex: opts.getBoardZIndex ?? (() => ({ max: 10, min: 0 })),
    defaultItemColor: opts.defaultItemColor ?? '#CCCCCC',
    resolveTextColor: () => '#111111',
  });

  return {
    api,
    applyOps,
    onContainerClick,
    breakFollowOnEdit,
    setSelected: (nodes: MockNode[], edges: MockEdge[] = []) => {
      selectedNodesRef.value = nodes;
      selectedEdgesRef.value = edges;
    },
  };
}

/**
 * Представление операций в assertions. Каждый тест обращается только к полям
 * подходящей операции; Vitest не сохраняет параметр `vi.fn` в типе mock.calls,
 * поэтому изолируем это сужение здесь, а не допускаем `any` в callback-ах тестов.
 */
type InspectedBoardOp = {
  type: BoardOp['type'];
  id: string;
  item: Pick<BoardItem, 'id' | 'content' | 'style' | 'zIndex'>;
  patch: Partial<BoardItem> & { style: BoardItemStyle };
};

function lastOps(applyOps: ReturnType<typeof vi.fn>): InspectedBoardOp[] {
  return (applyOps.mock.calls[applyOps.mock.calls.length - 1]?.[0] ?? []) as InspectedBoardOp[];
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
      [item('f2', { content: { type: 'giphy', id: 'abc123', width: 100, height: 80 } }), 'giphy'],
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

  it('canUngroup: a group nested in a frame is also ungroupable when selected directly (14.8)', () => {
    const topLevelGroup = flowNode(item('g1', { content: { type: 'group' } }));
    const nestedGroup = flowNode(item('g2', { content: { type: 'group' }, parentId: 'fr' }));

    // Верхнеуровневая группа: parentId всегда null — сама по себе не разгруппировывается
    expect(makeSelection({ selectedNodes: [topLevelGroup] }).api.canUngroupSelection.value).toBe(
      false,
    );
    // Вложенная во фрейм — её собственный parentId уже не null (14.8)
    expect(makeSelection({ selectedNodes: [nestedGroup] }).api.canUngroupSelection.value).toBe(
      true,
    );
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
    if (!create) throw new Error('Expected item.create operation');
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

  it('dissolves a group nested in a frame: members inherit the frame, not null (14.8)', () => {
    const frame = item('fr', { content: { type: 'frame', title: 'F' } });
    const group = item('g', { content: { type: 'group' }, parentId: 'fr' });
    const member = item('m', { parentId: 'g' });
    const { api, applyOps } = makeSelection({
      selectedNodes: [flowNode(member)],
      items: [frame, group, member],
    });

    api.ungroupSelection();
    const ops = lastOps(applyOps);
    expect(
      ops.some((op) => op.type === 'item.patch' && op.id === 'm' && op.patch.parentId === 'fr'),
    ).toBe(true);
    expect(ops.some((op) => op.type === 'item.delete' && op.id === 'g')).toBe(true);
  });

  it('dissolves a group selected directly (not via a member) — only reachable when nested in a frame (14.8)', () => {
    const frame = item('fr', { content: { type: 'frame', title: 'F' } });
    const group = item('g', { content: { type: 'group' }, parentId: 'fr' });
    const member = item('m', { parentId: 'g' });
    const { api, applyOps } = makeSelection({
      selectedNodes: [flowNode(group)],
      items: [frame, group, member],
    });

    api.ungroupSelection();
    const ops = lastOps(applyOps);
    expect(
      ops.some((op) => op.type === 'item.patch' && op.id === 'm' && op.patch.parentId === 'fr'),
    ).toBe(true);
    expect(ops.some((op) => op.type === 'item.delete' && op.id === 'g')).toBe(true);
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
    const op = lastOps(applyOps)[0]!;
    expect(op.type).toBe('item.patch');
    expect(op.patch.content).toEqual({ type: 'text', text: 'hello' });
  });

  it('converts sticky text content to a shape, preserving text', () => {
    const { api, applyOps } = makeSelection({
      selectedNodes: [flowNode(item('a', { content: { type: 'sticky', text: 'hello' } }))],
    });
    api.setSelectedForm('rectangle');
    const op = lastOps(applyOps)[0]!;
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
    const op = lastOps(applyOps)[0]!;
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
    expect(cancelOps.map((op) => op.id)).toEqual(['a']);
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

  it('canIncreaseSelectedFontSize is false once the DOM-measured size already clamps below the base (26.08.2026)', () => {
    // Реальный сценарий — авто-fit (useFitFontSize) ужал отрисованный размер
    // ниже базы, потому что длинный текст не помещается даже при базовом
    // размере, и сообщил об этом через effectiveFontSizeRegistry (26.08.2026:
    // раньше это же симулировалось несовпадением геометрии бокса с дефолтной —
    // с момента, когда resize сам пересчитывает базу под текущий бокс
    // (`onResizeEnd`), несовпадение геометрии больше не возникает само по
    // себе, единственный источник расхождения — реальное DOM-измерение).
    // Кнопка "+" не должна молча ничего не делать в этом состоянии.
    const node = flowNode(
      item('a', { content: { type: 'sticky', text: 'x' }, style: { color: '#fff', fontSize: 20 } }),
    );
    const { api } = makeSelection({ selectedNodes: [node] });
    api.effectiveFontSizeRegistry.set('a', 10);
    expect(api.selectedFontSize.value).toBe(10);
    expect(api.canIncreaseSelectedFontSize.value).toBe(false);
  });

  it('canIncreaseSelectedFontSize stays true while the DOM-measured size matches the base', () => {
    const node = flowNode(
      item('a', { content: { type: 'sticky', text: 'x' }, style: { color: '#fff', fontSize: 20 } }),
    );
    const { api } = makeSelection({ selectedNodes: [node] });
    api.effectiveFontSizeRegistry.set('a', 20);
    expect(api.selectedFontSize.value).toBe(20);
    expect(api.canIncreaseSelectedFontSize.value).toBe(true);
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
    const op = lastOps(applyOps)[0]!;
    expect(op.patch.style.fontSize).toBe(BOARD_ITEM_FONT_SIZE_MAX);
  });

  it('setSelectedFontSize re-anchors fontSizeBoxWidth/Height to the current box (26.08.2026)', () => {
    // Иначе следующий resize в manual считал бы расхождение от устаревшего
    // якоря, оставшегося от предыдущего auto-периода — а не от бокса, каким
    // он был в момент, когда пользователь только что явно задал это число.
    const a = flowNode(
      item('a', {
        content: { type: 'frame', title: 'F' },
        width: 240,
        height: 160,
        style: { color: '#fff', fontSize: 20, fontSizeBoxWidth: 120, fontSizeBoxHeight: 80 },
      }),
      { x: 0, y: 0 },
      { width: 240, height: 160 },
    );
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedFontSize(32);
    const op = lastOps(applyOps)[0]!;
    expect(op.patch.style.fontSizeBoxWidth).toBe(240);
    expect(op.patch.style.fontSizeBoxHeight).toBe(160);
  });

  it('setSelectedFontSize still switches auto to manual even when the clamped number is unchanged (26.08.2026)', () => {
    const a = flowNode(
      item('a', {
        content: { type: 'frame', title: 'F' },
        style: { color: '#fff', fontSize: BOARD_ITEM_FONT_SIZE_MAX },
      }),
    );
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedFontSize(BOARD_ITEM_FONT_SIZE_MAX + 100);
    const op = lastOps(applyOps)[0]!;
    expect(op.patch.style.fontSize).toBe(BOARD_ITEM_FONT_SIZE_MAX);
    expect(op.patch.style.fontSizeMode).toBe('manual');
  });

  it('setSelectedFontSize is a true no-op once already manual and clamped value is unchanged', () => {
    const a = flowNode(
      item('a', {
        content: { type: 'frame', title: 'F' },
        style: { color: '#fff', fontSize: BOARD_ITEM_FONT_SIZE_MAX, fontSizeMode: 'manual' },
      }),
    );
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedFontSize(BOARD_ITEM_FONT_SIZE_MAX + 100);
    expect(applyOps).not.toHaveBeenCalled();
  });

  it('setSelectedFontSizeMode switches back to auto without changing fontSize when the box never moved while manual', () => {
    // Якорь не задан явно — по умолчанию считается равным текущему боксу
    // узла (120x80, см. `item()`), значит расхождения нет и число не меняется.
    const a = flowNode(
      item('a', {
        content: { type: 'frame', title: 'F' },
        style: { color: '#fff', fontSize: 30, fontSizeMode: 'manual' },
      }),
    );
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedFontSizeMode('auto');
    const op = lastOps(applyOps)[0]!;
    expect(op.patch.style.fontSizeMode).toBe('auto');
    expect(op.patch.style.fontSize).toBe(30);
    expect(op.patch.style.fontSizeBoxWidth).toBe(120);
    expect(op.patch.style.fontSizeBoxHeight).toBe(80);
  });

  it('setSelectedFontSizeMode(auto) catches up on box growth that happened while manual (26.08.2026, Miro-style)', () => {
    // Ровно репортнутый пользователем сценарий: manual=4 установлен на боксе
    // 90x90 (якорь), затем стикер увеличен вдвое (180x180) БЕЗ изменения
    // fontSize (manual не трогает его при resize) — переключение на auto
    // должно досчитать это расхождение одним пересчётом, а не ждать
    // следующего resize.
    const a = flowNode(
      item('a', {
        content: { type: 'sticky', text: 'x' },
        width: 180,
        height: 180,
        style: {
          color: '#fff',
          fontSize: 4,
          fontSizeMode: 'manual',
          fontSizeBoxWidth: 90,
          fontSizeBoxHeight: 90,
        },
      }),
      { x: 0, y: 0 },
      { width: 180, height: 180 },
    );
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedFontSizeMode('auto');
    const op = lastOps(applyOps)[0]!;
    expect(op.patch.style.fontSizeMode).toBe('auto');
    // getScaledFontSize floor's ниже FIT_FONT_MIN=10 (та же авто-fit защита от
    // переполнения, что и внутри resize) — математически 4*2=8, но 10 — то же
    // число, что видел пользователь в живом репорте этого бага.
    expect(op.patch.style.fontSize).toBe(10);
    expect(op.patch.style.fontSizeBoxWidth).toBe(180);
    expect(op.patch.style.fontSizeBoxHeight).toBe(180);
  });

  it('setSelectedFontSizeMode is a no-op when already in the target mode', () => {
    const a = flowNode(
      item('a', { content: { type: 'frame', title: 'F' }, style: { color: '#fff', fontSize: 20 } }),
    );
    const { api, applyOps } = makeSelection({ selectedNodes: [a] });
    api.setSelectedFontSizeMode('auto');
    expect(applyOps).not.toHaveBeenCalled();
  });

  it('manual mode: selectedFontSize fallback is the base as-is, regardless of box dimensions (26.08.2026: same as auto now — see selectedFontSize)', () => {
    const shrunk = flowNode(
      item('a', {
        content: { type: 'sticky', text: 'x' },
        style: { color: '#fff', fontSize: 20, fontSizeMode: 'manual' },
      }),
      { x: 0, y: 0 },
      { width: 60, height: 40 },
    );
    const { api } = makeSelection({ selectedNodes: [shrunk] });
    expect(api.selectedFontSize.value).toBe(20);
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

  it('setSelectedGiphy only patches giphy nodes', () => {
    const gif = flowNode(
      item('g1', { content: { type: 'giphy', id: 'old', width: 1, height: 1 } }),
    );
    const sticky = flowNode(item('s1'));
    const { api, applyOps } = makeSelection({ selectedNodes: [gif, sticky] });
    api.setSelectedGiphy({
      id: 'new',
      title: 'New',
      previewWidth: 10,
      previewHeight: 8,
      width: 480,
      height: 384,
    });
    const ops = lastOps(applyOps);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe('g1');
    expect(ops[0]!.patch.content).toEqual({ type: 'giphy', id: 'new', width: 480, height: 384 });
  });
});

describe('useBoardSelection — setSelectedFrameSize (22.4.2)', () => {
  it('patches width/height of a selected frame to the preset dimensions', () => {
    const frame = flowNode(item('f1', { content: { type: 'frame', title: 'F' } }));
    const { api, applyOps } = makeSelection({ selectedNodes: [frame] });
    api.setSelectedFrameSize('square');
    const ops = lastOps(applyOps);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe('f1');
    expect(ops[0]!.patch).toEqual({ width: 800, height: 800 });
  });

  it('ignores non-frame nodes even when a frame is selected alongside them', () => {
    const frame = flowNode(item('f1', { content: { type: 'frame', title: 'F' } }));
    const sticky = flowNode(item('s1'));
    const { api, applyOps } = makeSelection({ selectedNodes: [frame, sticky] });
    api.setSelectedFrameSize('a4');
    const ops = lastOps(applyOps);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe('f1');
  });

  it('"custom" is a no-op — free-form size, does not call applyOps at all', () => {
    const frame = flowNode(item('f1', { content: { type: 'frame', title: 'F' } }));
    const { api, applyOps } = makeSelection({ selectedNodes: [frame] });
    api.setSelectedFrameSize('custom');
    expect(applyOps).not.toHaveBeenCalled();
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
    expect(ops.map((op) => op.patch.zIndex ?? 0).sort((x, y) => x - y)).toEqual([11, 12]);
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
    expect(ops.map((op) => op.patch.zIndex ?? 0).sort((x, y) => x - y)).toEqual([-2, -1]);
  });

  it('bringSelectedToFront on a selected edge emits edge.patch, not item.patch (12.21)', () => {
    const edge = flowEdge(boardEdge('e1'));
    const { api, applyOps } = makeSelection({
      selectedEdges: [edge],
      getBoardZIndex: () => ({ max: 10, min: 0 }),
    });
    api.bringSelectedToFront();
    const ops = lastOps(applyOps);
    expect(ops).toEqual([
      { type: 'edge.patch', clientOpId: expect.any(String), id: 'e1', patch: { zIndex: 11 } },
    ]);
  });

  it('sendSelectedToBack on a selected edge emits edge.patch below current min (12.21)', () => {
    const edge = flowEdge(boardEdge('e1'));
    const { api, applyOps } = makeSelection({
      selectedEdges: [edge],
      getBoardZIndex: () => ({ max: 10, min: 0 }),
    });
    api.sendSelectedToBack();
    const ops = lastOps(applyOps);
    expect(ops).toEqual([
      { type: 'edge.patch', clientOpId: expect.any(String), id: 'e1', patch: { zIndex: -1 } },
    ]);
  });

  it('bringSelectedToFront with a mixed node+edge selection shares one contiguous zIndex range (12.21)', () => {
    const a = flowNode(item('a'));
    const edge = flowEdge(boardEdge('e1'));
    const { api, applyOps } = makeSelection({
      selectedNodes: [a],
      selectedEdges: [edge],
      getBoardZIndex: () => ({ max: 10, min: 0 }),
    });
    api.bringSelectedToFront();
    const ops = lastOps(applyOps);
    expect(ops.map((op) => op.patch.zIndex)).toEqual([11, 12]);
    expect(ops.map((op) => op.type)).toEqual(['item.patch', 'edge.patch']);
  });
});

describe('useBoardSelection — delete ops', () => {
  it('deleteSelected emits item.delete for each selected node', () => {
    const { api, applyOps } = makeSelection({
      selectedNodes: [flowNode(item('a')), flowNode(item('b'))],
    });
    api.deleteSelected();
    const ops = lastOps(applyOps);
    expect(ops.map((op) => op.type)).toEqual(['item.delete', 'item.delete']);
    expect(ops.map((op) => op.id).sort()).toEqual(['a', 'b']);
  });

  describe('deleteSelection — mixed node+edge (12.22)', () => {
    it('unrelated node and edge — both get an explicit delete op', () => {
      const a = flowNode(item('a'));
      const edge = flowEdge(boardEdge('e1', { sourceItemId: 'src', targetItemId: 'tgt' }));
      const { api, applyOps } = makeSelection({ selectedNodes: [a], selectedEdges: [edge] });
      api.deleteSelection();
      const ops = lastOps(applyOps);
      expect(ops.map((op) => op.type)).toEqual(['item.delete', 'edge.delete']);
      expect(ops.map((op) => op.id).sort()).toEqual(['a', 'e1']);
    });

    it('edge connecting two selected cards is skipped — server cascades it with its item.delete', () => {
      // Регрессия 12.22: явный edge.delete тут получил бы «Связь не найдена»,
      // т.к. сервер уже удалит связь каскадом вместе с первой же карточкой
      // в том же батче.
      const a = flowNode(item('a'));
      const b = flowNode(item('b'));
      const edge = flowEdge(boardEdge('e1', { sourceItemId: 'a', targetItemId: 'b' }));
      const { api, applyOps } = makeSelection({
        selectedNodes: [a, b],
        selectedEdges: [edge],
      });
      api.deleteSelection();
      const ops = lastOps(applyOps);
      expect(ops.map((op) => op.type)).toEqual(['item.delete', 'item.delete']);
      expect(ops.map((op) => op.id).sort()).toEqual(['a', 'b']);
    });

    it('edge with only ONE endpoint selected is also skipped', () => {
      const a = flowNode(item('a'));
      const edge = flowEdge(boardEdge('e1', { sourceItemId: 'a', targetItemId: 'other' }));
      const { api, applyOps } = makeSelection({
        selectedNodes: [a],
        selectedEdges: [edge],
      });
      api.deleteSelection();
      const ops = lastOps(applyOps);
      expect(ops).toEqual([{ type: 'item.delete', clientOpId: expect.any(String), id: 'a' }]);
    });

    it('no-op when nothing is selected', () => {
      const { api, applyOps } = makeSelection({});
      api.deleteSelection();
      expect(applyOps).not.toHaveBeenCalled();
    });
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
