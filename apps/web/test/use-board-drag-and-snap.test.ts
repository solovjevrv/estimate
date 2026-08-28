import type { BoardItem, BoardOp } from '@estimate/shared';
import { describe, expect, it, vi } from 'vitest';

import { useBoardDragAndSnap } from '../src/features/boards/composables/use-board-drag-and-snap';
import type { BoardDragEvent } from '../src/features/boards/adapters/vue-flow-adapter';

type BoardItemPatchOp = Extract<BoardOp, { type: 'item.patch' }>;

/**
 * Лёгкий MockNode — плоский объект с теми полями, которые composable читает.
 * Структурно совместим с `BoardDragNode` (и тем самым с Vue Flow `GraphNode`),
 * поэтому в payload события приведение типа не требуется.
 */
interface MockNode {
  id: string;
  data: BoardItem;
  position: { x: number; y: number };
  computedPosition: { x: number; y: number; z: number };
  dimensions: { width: number; height: number };
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
): MockNode {
  return {
    id: data.id,
    position: { x: pos.x, y: pos.y },
    computedPosition: { x: pos.x, y: pos.y, z: 0 },
    dimensions: { width: dims.width, height: dims.height },
    data,
  };
}

function nodeEvent(nodes: MockNode[], eventInit: Partial<MouseEvent> = {}): BoardDragEvent {
  const event = new MouseEvent('mousemove', eventInit);
  return {
    event,
    nodes,
  };
}

interface MakeOptions {
  items?: BoardItem[];
  flowNodes?: MockNode[];
  canEdit?: () => boolean;
  zoom?: number;
  findFrameAt?: (point: { x: number; y: number }, excludeId?: string) => BoardItem | undefined;
}

function makeDrag(opts: MakeOptions = {}) {
  const applyOps = vi.fn<(ops: BoardOp[], options?: unknown) => void>();
  const breakFollowOnEdit = vi.fn();
  const findFrameAt =
    opts.findFrameAt ??
    vi.fn<(point: { x: number; y: number }, excludeId?: string) => BoardItem | undefined>();

  const itemsRef = opts.items ?? [];
  const nodesRef = opts.flowNodes ?? [];
  const zoomRef = opts.zoom ?? 1;

  const api = useBoardDragAndSnap({
    canEdit: opts.canEdit ?? (() => true),
    getItems: () => itemsRef,
    getNodes: () => nodesRef,
    getZoom: () => zoomRef,
    applyOps,
    breakFollowOnEdit,
    findFrameAt,
  });

  return { api, applyOps, breakFollowOnEdit, findFrameAt };
}

/** Извлекает ops и options из последнего вызова applyOps */
function lastApplyOps(applyOps: ReturnType<typeof vi.fn>): { ops: BoardOp[]; options?: unknown } {
  const lastCall = applyOps.mock.calls[applyOps.mock.calls.length - 1];
  return { ops: lastCall![0], options: lastCall![1] };
}

describe('useBoardDragAndSnap — onNodeDragStart', () => {
  it('устанавливает isDragging в true и запоминает стартовые позиции', () => {
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem, { x: 100, y: 200 });
    const { api } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    expect(api.isDragging.value).toBe(false);
    api.onNodeDragStart(nodeEvent([node]));
    expect(api.isDragging.value).toBe(true);
  });

  it('вызывает breakFollowOnEdit при старте драга', () => {
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem);
    const { api, breakFollowOnEdit } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    api.onNodeDragStart(nodeEvent([node]));
    expect(breakFollowOnEdit).toHaveBeenCalledOnce();
  });

  it('не начинает drag, если canEdit возвращает false', () => {
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem);
    const { api, applyOps, breakFollowOnEdit } = makeDrag({
      items: [nodeItem],
      flowNodes: [node],
      canEdit: () => false,
    });

    api.onNodeDragStart(nodeEvent([node]));
    api.onNodeDrag(nodeEvent([node]));
    api.onNodeDragStop(nodeEvent([node]));
    expect(api.isDragging.value).toBe(false);
    expect(breakFollowOnEdit).not.toHaveBeenCalled();
    expect(applyOps).not.toHaveBeenCalled();
  });
});

describe('useBoardDragAndSnap — onNodeDrag (throttled патчи)', () => {
  it('отправляет item.patch с новой позицией и cascade-детей контейнера', () => {
    const frameItem = item('frame-1', {
      content: { type: 'frame', title: 'Frame' },
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    });
    const childItem = item('child-1', { parentId: frameItem.id, x: 120, y: 120 });
    const frameNode = flowNode(frameItem, { x: 100, y: 100 });
    const childNode = flowNode(childItem, { x: 120, y: 120 });

    const { api, applyOps } = makeDrag({
      items: [frameItem, childItem],
      flowNodes: [frameNode, childNode],
    });

    api.onNodeDragStart(nodeEvent([frameNode]));

    // Сдвигаем фрейм на (20, 30)
    frameNode.computedPosition.x = 120;
    frameNode.computedPosition.y = 130;
    frameNode.position.x = 120;
    frameNode.position.y = 130;

    api.onNodeDrag(nodeEvent([frameNode]));

    expect(applyOps).toHaveBeenCalled();
    const { ops, options } = lastApplyOps(applyOps);

    // Ожидаем: patch фрейму + patch ребёнку с той же дельтой
    const framePatch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'frame-1',
    );
    expect(framePatch).toBeDefined();
    expect(framePatch!.patch).toMatchObject({ x: 120, y: 130 });

    const childPatch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'child-1',
    );
    expect(childPatch).toBeDefined();
    expect(childPatch!.patch).toMatchObject({ x: 140, y: 150 });

    // record: false для промежуточных тиков
    expect(options).toEqual({ record: false });
  });

  it('при мультивыборе группы сдвигает всех участников одной дельтой', () => {
    const groupItem = item('group-1', { content: { type: 'group' } });
    const mate1 = item('mate-1', { parentId: groupItem.id });
    const mate2 = item('mate-2', { parentId: groupItem.id });
    const draggable = item('draggable', { parentId: groupItem.id });

    const groupNode = flowNode(groupItem, { x: 0, y: 0 });
    const mate1Node = flowNode(mate1, { x: 0, y: 0 });
    const mate2Node = flowNode(mate2, { x: 10, y: 10 });
    const draggableNode = flowNode(draggable, { x: 20, y: 20 });

    const { api, applyOps } = makeDrag({
      items: [groupItem, mate1, mate2, draggable],
      flowNodes: [groupNode, mate1Node, mate2Node, draggableNode],
    });

    api.onNodeDragStart(nodeEvent([draggableNode]));

    // Сдвигаем draggable на (5, 5)
    draggableNode.computedPosition.x = 25;
    draggableNode.computedPosition.y = 25;
    draggableNode.position.x = 25;
    draggableNode.position.y = 25;

    api.onNodeDrag(nodeEvent([draggableNode]));

    const { ops } = lastApplyOps(applyOps);
    // draggable patch
    const draggablePatch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'draggable',
    );
    expect(draggablePatch).toBeDefined();
    expect(draggablePatch!.patch).toMatchObject({ x: 25, y: 25 });

    // group + mates should shift by same delta (5, 5)
    const groupPatch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'group-1',
    );
    expect(groupPatch).toBeDefined();
    expect(groupPatch!.patch).toMatchObject({ x: 5, y: 5 });

    const mate1Patch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'mate-1',
    );
    expect(mate1Patch).toBeDefined();
    expect(mate1Patch!.patch).toMatchObject({ x: 5, y: 5 });
  });

  it('перетаскивание фрейма с вложенной группой сдвигает и группу, и её участников (14.8)', () => {
    const frameItem = item('frame-1', {
      content: { type: 'frame', title: 'Frame' },
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    });
    const groupItem = item('group-1', { content: { type: 'group' }, parentId: frameItem.id });
    const memberItem = item('member-1', { parentId: groupItem.id, x: 130, y: 130 });
    const frameNode = flowNode(frameItem, { x: 100, y: 100 });
    const groupNode = flowNode(groupItem, { x: 0, y: 0 });
    const memberNode = flowNode(memberItem, { x: 130, y: 130 });

    const { api, applyOps } = makeDrag({
      items: [frameItem, groupItem, memberItem],
      flowNodes: [frameNode, groupNode, memberNode],
    });

    api.onNodeDragStart(nodeEvent([frameNode]));

    // Сдвигаем фрейм на (20, 30)
    frameNode.computedPosition.x = 120;
    frameNode.computedPosition.y = 130;
    frameNode.position.x = 120;
    frameNode.position.y = 130;

    api.onNodeDrag(nodeEvent([frameNode]));

    const { ops } = lastApplyOps(applyOps);
    // Группа (прямой ребёнок фрейма) сдвинута на ту же дельту
    const groupPatch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'group-1',
    );
    expect(groupPatch).toBeDefined();
    expect(groupPatch!.patch).toMatchObject({ x: 20, y: 30 });
    // Участник группы (косвенный потомок фрейма, parentId указывает на группу,
    // не на фрейм) — без рекурсивного descendantsOf остался бы на месте
    const memberPatch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'member-1',
    );
    expect(memberPatch).toBeDefined();
    expect(memberPatch!.patch).toMatchObject({ x: 150, y: 160 });
  });

  it('throttle: intermediate ticks deduplicated within wait window', () => {
    vi.useFakeTimers();
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem, { x: 0, y: 0 });
    const { api, applyOps } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    try {
      api.onNodeDragStart(nodeEvent([node]));

      node.computedPosition.x = 10;
      node.position.x = 10;
      api.onNodeDrag(nodeEvent([node]));

      node.computedPosition.x = 20;
      node.position.x = 20;
      api.onNodeDrag(nodeEvent([node]));

      // Второй вызов в пределах throttle window должен привести к одному ops batch.
      expect(applyOps).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useBoardDragAndSnap — Shift axis-lock', () => {
  it('блокирует перемещение по оси с меньшей дельтой при зажатом Shift', () => {
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem, { x: 0, y: 0 });
    const { api } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    api.onNodeDragStart(nodeEvent([node]));

    // Сдвиг по X больше, чем по Y — Y должен быть зафиксирован
    node.computedPosition.x = 50;
    node.position.x = 50;
    node.computedPosition.y = 10;
    node.position.y = 10;

    api.onNodeDrag(nodeEvent([node], { shiftKey: true }));

    expect(node.computedPosition.y).toBe(0);
  });

  it('блокирует перемещение по X, если |dy| > |dx| при зажатом Shift', () => {
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem, { x: 0, y: 0 });
    const { api } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    api.onNodeDragStart(nodeEvent([node]));

    node.computedPosition.x = 10;
    node.position.x = 10;
    node.computedPosition.y = 50;
    node.position.y = 50;

    api.onNodeDrag(nodeEvent([node], { shiftKey: true }));

    expect(node.computedPosition.x).toBe(0);
  });

  it('без Shift не блокирует движение по осям', () => {
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem, { x: 0, y: 0 });
    const { api } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    api.onNodeDragStart(nodeEvent([node]));

    node.computedPosition.x = 50;
    node.position.x = 50;
    node.computedPosition.y = 30;
    node.position.y = 30;

    api.onNodeDrag(nodeEvent([node]));

    expect(node.computedPosition.x).toBe(50);
    expect(node.computedPosition.y).toBe(30);
  });
});

describe('useBoardDragAndSnap — onNodeDragStop (snap + parent reassignment)', () => {
  it('применяет snap position на основе активных snap guides', () => {
    const staticItem = item('static-1', { x: 200, y: 0 });
    const draggedItem = item('dragged-1', { x: 0, y: 0 });
    const staticNode = flowNode(staticItem, { x: 200, y: 0 });
    const draggedNode = flowNode(draggedItem, { x: 195, y: 0 });

    const { api, applyOps } = makeDrag({
      items: [staticItem, draggedItem],
      flowNodes: [staticNode, draggedNode],
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));

    // Начинаем драб чуть рядом с static (x=195, left=195; b left=200, diff=5 < 8px threshold)
    api.onNodeDrag(nodeEvent([draggedNode]));
    api.onNodeDragStop(nodeEvent([draggedNode]));

    const { ops } = lastApplyOps(applyOps);
    const patch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'dragged-1',
    );
    expect(patch).toBeDefined();
    // Снапнуто к левому краю static: x=200
    expect(patch!.patch.x).toBe(200);
  });

  it('приклеивает элемент к фрейму, если центр попадает в его границы', () => {
    const frameItem = item('frame-1', {
      content: { type: 'frame', title: 'Frame' },
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    const draggedItem = item('dragged-1', { x: 300, y: 0 });
    const frameNode = flowNode(frameItem, { x: 100, y: 100 }, { width: 200, height: 200 });
    const draggedNode = flowNode(draggedItem, { x: 300, y: 0 });

    const { api, applyOps } = makeDrag({
      items: [frameItem, draggedItem],
      flowNodes: [frameNode, draggedNode],
      canEdit: () => true,
      findFrameAt: vi.fn().mockReturnValue(frameItem),
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));

    // Перетаскиваем в центр фрейма (200, 200)
    draggedNode.computedPosition.x = 200;
    draggedNode.computedPosition.y = 200;
    draggedNode.position.x = 200;
    draggedNode.position.y = 200;

    api.onNodeDragStop(nodeEvent([draggedNode]));

    const { ops } = lastApplyOps(applyOps);
    const patch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'dragged-1',
    );
    expect(patch).toBeDefined();
    expect(patch!.patch).toMatchObject({ x: 200, y: 200, parentId: 'frame-1' });
  });

  it('отсоединяет элемент от фрейма, если он вынесен за пределы', () => {
    const frameItem = item('frame-1', {
      content: { type: 'frame', title: 'Frame' },
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    const draggedItem = item('dragged-1', { parentId: frameItem.id, x: 150, y: 150 });
    const frameNode = flowNode(frameItem, { x: 100, y: 100 }, { width: 200, height: 200 });
    const draggedNode = flowNode(draggedItem, { x: 500, y: 500 });

    const { api, applyOps } = makeDrag({
      items: [frameItem, draggedItem],
      flowNodes: [frameNode, draggedNode],
      findFrameAt: vi.fn().mockReturnValue(undefined),
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));

    api.onNodeDragStop(nodeEvent([draggedNode]));

    const { ops } = lastApplyOps(applyOps);
    const patch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'dragged-1',
    );
    expect(patch).toBeDefined();
    expect(patch!.patch.parentId).toBeNull();
  });

  it('приклеивает ГРУППУ к фрейму, если её центр попадает в его границы (14.8)', () => {
    const frameItem = item('frame-1', {
      content: { type: 'frame', title: 'Frame' },
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    const groupItem = item('group-1', { content: { type: 'group' }, x: 300, y: 0 });
    const frameNode = flowNode(frameItem, { x: 100, y: 100 }, { width: 200, height: 200 });
    const groupNode = flowNode(groupItem, { x: 300, y: 0 });

    const { api, applyOps } = makeDrag({
      items: [frameItem, groupItem],
      flowNodes: [frameNode, groupNode],
      findFrameAt: vi.fn().mockReturnValue(frameItem),
    });

    api.onNodeDragStart(nodeEvent([groupNode]));
    groupNode.computedPosition.x = 200;
    groupNode.computedPosition.y = 200;
    groupNode.position.x = 200;
    groupNode.position.y = 200;
    api.onNodeDragStop(nodeEvent([groupNode]));

    const { ops } = lastApplyOps(applyOps);
    const patch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'group-1',
    );
    expect(patch).toBeDefined();
    expect(patch!.patch).toMatchObject({ x: 200, y: 200, parentId: 'frame-1' });
  });

  it('отсоединяет ГРУППУ от фрейма, если её вынесли за пределы (14.8)', () => {
    const frameItem = item('frame-1', {
      content: { type: 'frame', title: 'Frame' },
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    const groupItem = item('group-1', {
      content: { type: 'group' },
      parentId: frameItem.id,
      x: 150,
      y: 150,
    });
    const frameNode = flowNode(frameItem, { x: 100, y: 100 }, { width: 200, height: 200 });
    const groupNode = flowNode(groupItem, { x: 500, y: 500 });

    const { api, applyOps } = makeDrag({
      items: [frameItem, groupItem],
      flowNodes: [frameNode, groupNode],
      findFrameAt: vi.fn().mockReturnValue(undefined),
    });

    api.onNodeDragStart(nodeEvent([groupNode]));
    api.onNodeDragStop(nodeEvent([groupNode]));

    const { ops } = lastApplyOps(applyOps);
    const patch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'group-1',
    );
    expect(patch).toBeDefined();
    expect(patch!.patch.parentId).toBeNull();
  });

  it('драг УЧАСТНИКА группы приклеивает саму группу к фрейму, если её новый центр попадает в границы (14.8)', () => {
    const frameItem = item('frame-1', {
      content: { type: 'frame', title: 'Frame' },
      x: 500,
      y: 100,
      width: 200,
      height: 200,
    });
    const groupItem = item('group-1', {
      content: { type: 'group' },
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const memberItem = item('member-1', { parentId: groupItem.id, x: 20, y: 20 });
    const frameNode = flowNode(frameItem, { x: 500, y: 100 }, { width: 200, height: 200 });
    const groupNode = flowNode(groupItem, { x: 0, y: 0 }, { width: 100, height: 100 });
    const memberNode = flowNode(memberItem, { x: 20, y: 20 });

    const { api, applyOps } = makeDrag({
      items: [frameItem, groupItem, memberItem],
      flowNodes: [frameNode, groupNode, memberNode],
      // Группа (100x100) сдвинута на (500,100) окажется точно в границах фрейма
      findFrameAt: vi.fn().mockReturnValue(frameItem),
    });

    api.onNodeDragStart(nodeEvent([memberNode]));
    // Тащим участника на (500, 100) — та же дельта сдвигает и группу-обёртку
    memberNode.computedPosition.x = 520;
    memberNode.computedPosition.y = 120;
    memberNode.position.x = 520;
    memberNode.position.y = 120;
    api.onNodeDragStop(nodeEvent([memberNode]));

    const { ops } = lastApplyOps(applyOps);
    const groupPatch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'group-1',
    );
    expect(groupPatch).toBeDefined();
    // Позиция сдвинута ТЕМ ЖЕ каскадом, и parentId теперь указывает на фрейм
    expect(groupPatch!.patch).toMatchObject({ x: 500, y: 100, parentId: 'frame-1' });
  });

  it('драг УЧАСТНИКА группы отклеивает группу от фрейма, если она вынесена за его пределы (14.8)', () => {
    const frameItem = item('frame-1', {
      content: { type: 'frame', title: 'Frame' },
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    const groupItem = item('group-1', {
      content: { type: 'group' },
      parentId: frameItem.id,
      x: 150,
      y: 150,
      width: 50,
      height: 50,
    });
    const memberItem = item('member-1', { parentId: groupItem.id, x: 160, y: 160 });
    const frameNode = flowNode(frameItem, { x: 100, y: 100 }, { width: 200, height: 200 });
    const groupNode = flowNode(groupItem, { x: 150, y: 150 }, { width: 50, height: 50 });
    const memberNode = flowNode(memberItem, { x: 160, y: 160 });

    const { api, applyOps } = makeDrag({
      items: [frameItem, groupItem, memberItem],
      flowNodes: [frameNode, groupNode, memberNode],
      // Группа вынесена далеко за пределы фрейма — findFrameAt ничего не находит
      findFrameAt: vi.fn().mockReturnValue(undefined),
    });

    api.onNodeDragStart(nodeEvent([memberNode]));
    memberNode.computedPosition.x = 960;
    memberNode.computedPosition.y = 960;
    memberNode.position.x = 960;
    memberNode.position.y = 960;
    api.onNodeDragStop(nodeEvent([memberNode]));

    const { ops } = lastApplyOps(applyOps);
    const groupPatch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'group-1',
    );
    expect(groupPatch).toBeDefined();
    expect(groupPatch!.patch.parentId).toBeNull();
  });

  it('фрейм никогда не приклеивается к другому фрейму, даже если его центр попадает в границы (14.8)', () => {
    const outerFrame = item('frame-outer', {
      content: { type: 'frame', title: 'Outer' },
      x: 0,
      y: 0,
      width: 500,
      height: 500,
    });
    const innerFrame = item('frame-inner', {
      content: { type: 'frame', title: 'Inner' },
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    });
    const outerNode = flowNode(outerFrame, { x: 0, y: 0 }, { width: 500, height: 500 });
    const innerNode = flowNode(innerFrame, { x: 300, y: 0 }, { width: 100, height: 100 });

    const { api, applyOps } = makeDrag({
      items: [outerFrame, innerFrame],
      flowNodes: [outerNode, innerNode],
      // Даже если findFrameAt (мок) вернул бы контейнер — resolveDragParent
      // обязан отфильтровать фрейм ДО обращения к findFrameAt
      findFrameAt: vi.fn().mockReturnValue(outerFrame),
    });

    api.onNodeDragStart(nodeEvent([innerNode]));
    innerNode.computedPosition.x = 150;
    innerNode.computedPosition.y = 150;
    innerNode.position.x = 150;
    innerNode.position.y = 150;
    api.onNodeDragStop(nodeEvent([innerNode]));

    const { ops } = lastApplyOps(applyOps);
    const patch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'frame-inner',
    );
    expect(patch).toBeDefined();
    expect(patch!.patch.parentId).toBeUndefined();
  });

  it('не создаёт undo-запись для микродвижка без сдвига', () => {
    const nodeItem = item('node-1', { x: 0, y: 0 });
    const node = flowNode(nodeItem, { x: 0, y: 0 });

    const { api, applyOps } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    api.onNodeDragStart(nodeEvent([node]));

    // Никакого сдвига
    api.onNodeDragStop(nodeEvent([node]));

    const { options } = lastApplyOps(applyOps);
    // record: false — микродвижок не записывается в историю
    expect((options as { record?: boolean }).record).toBe(false);
  });

  it('создаёт undo-запись с inverse при реальном сдвиге', () => {
    const nodeItem = item('node-1', { x: 0, y: 0 });
    const node = flowNode(nodeItem, { x: 0, y: 0 });

    const { api, applyOps } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    api.onNodeDragStart(nodeEvent([node]));

    node.computedPosition.x = 50;
    node.position.x = 50;
    api.onNodeDragStop(nodeEvent([node]));

    const { options } = lastApplyOps(applyOps);
    expect((options as { record?: boolean }).record).toBe(true);
    expect((options as { inverse?: BoardOp[] }).inverse).toHaveLength(1);
    expect((options as { inverse?: BoardItemPatchOp[] }).inverse![0]).toMatchObject({
      type: 'item.patch',
      id: 'node-1',
      patch: { x: 0, y: 0 },
    });
  });

  it('сбрасывает isDragging в false после dragStop', () => {
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem, { x: 0, y: 0 });
    const { api } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    api.onNodeDragStart(nodeEvent([node]));
    expect(api.isDragging.value).toBe(true);

    node.computedPosition.x = 10;
    node.position.x = 10;
    api.onNodeDrag(nodeEvent([node]));
    api.onNodeDragStop(nodeEvent([node]));

    expect(api.isDragging.value).toBe(false);
  });

  it('отменяет pending промежуточный throttle после финального patch', () => {
    vi.useFakeTimers();
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem, { x: 0, y: 0 });
    const { api, applyOps } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    try {
      api.onNodeDragStart(nodeEvent([node]));
      node.computedPosition.x = 10;
      node.position.x = 10;
      api.onNodeDrag(nodeEvent([node]));
      node.computedPosition.x = 20;
      node.position.x = 20;
      api.onNodeDrag(nodeEvent([node]));
      api.onNodeDragStop(nodeEvent([node]));

      expect(applyOps).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1000);
      expect(applyOps).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('очищает snap guides после dragStop', () => {
    const staticItem = item('static-1', { x: 200, y: 0 });
    const draggedItem = item('dragged-1', { x: 195, y: 0 });
    const staticNode = flowNode(staticItem, { x: 200, y: 0 });
    const draggedNode = flowNode(draggedItem, { x: 195, y: 0 });

    const { api } = makeDrag({
      items: [staticItem, draggedItem],
      flowNodes: [staticNode, draggedNode],
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));
    api.onNodeDrag(nodeEvent([draggedNode]));

    expect(api.activeSnapGuides.value.length).toBeGreaterThan(0);

    api.onNodeDragStop(nodeEvent([draggedNode]));

    expect(api.activeSnapGuides.value).toEqual([]);
  });

  it('удаляет стартовые позиции из карты после dragStop', () => {
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem, { x: 0, y: 0 });

    const { api } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    api.onNodeDragStart(nodeEvent([node]));
    node.computedPosition.x = 10;
    node.position.x = 10;
    api.onNodeDragStop(nodeEvent([node]));

    // Повторный dragStop без dragStart не должен падать — карта пуста
    expect(() => api.onNodeDragStop(nodeEvent([node]))).not.toThrow();
  });
});

describe('useBoardDragAndSnap — reset', () => {
  it('очищает все throttlers через cancel()', () => {
    vi.useFakeTimers();
    const nodeItem = item('node-1');
    const node = flowNode(nodeItem, { x: 0, y: 0 });
    const { api, applyOps } = makeDrag({ items: [nodeItem], flowNodes: [node] });

    try {
      api.onNodeDragStart(nodeEvent([node]));
      node.computedPosition.x = 10;
      node.position.x = 10;
      api.onNodeDrag(nodeEvent([node]));
      node.computedPosition.x = 20;
      node.position.x = 20;
      api.onNodeDrag(nodeEvent([node]));

      api.reset();
      vi.advanceTimersByTime(1000);

      expect(applyOps).toHaveBeenCalledTimes(1);
      expect(api.isDragging.value).toBe(false);
      expect(api.activeSnapGuides.value).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('идемпотентен — вызов reset на чистом состоянии не падает', () => {
    const { api } = makeDrag();
    expect(() => api.reset()).not.toThrow();
  });
});

describe('useBoardDragAndSnap — равные отступы, 22.6', () => {
  it('показывает activeGapGuides и снапит позицию при совпадении с эталонным зазором на доске', () => {
    // Эталон: A(0..100) и B(300..400), gap=200. Перетаскиваемый узел стартует
    // так, что его зазор до D(800..900) почти совпадает (202 vs 200) — то же
    // геометрическое устройство, что и в board-snap.test.ts «равные отступы».
    const itemA = item('A', { x: 0, y: 0, width: 100, height: 100 });
    const itemB = item('B', { x: 300, y: 0, width: 100, height: 100 });
    const itemD = item('D', { x: 800, y: 0, width: 100, height: 100 });
    const draggedItem = item('dragged-1', { x: 498, y: 0, width: 100, height: 100 });

    const nodeA = flowNode(itemA, { x: 0, y: 0 }, { width: 100, height: 100 });
    const nodeB = flowNode(itemB, { x: 300, y: 0 }, { width: 100, height: 100 });
    const nodeD = flowNode(itemD, { x: 800, y: 0 }, { width: 100, height: 100 });
    const draggedNode = flowNode(draggedItem, { x: 498, y: 0 }, { width: 100, height: 100 });

    const { api, applyOps } = makeDrag({
      items: [itemA, itemB, itemD, draggedItem],
      flowNodes: [nodeA, nodeB, nodeD, draggedNode],
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));
    api.onNodeDrag(nodeEvent([draggedNode]));

    expect(api.activeGapGuides.value).toHaveLength(2);
    expect(api.activeGapGuides.value.every((g) => g.gap === 200)).toBe(true);

    api.onNodeDragStop(nodeEvent([draggedNode]));

    const { ops } = lastApplyOps(applyOps);
    const patch = ops.find(
      (o): o is BoardItemPatchOp => o.type === 'item.patch' && o.id === 'dragged-1',
    );
    expect(patch).toBeDefined();
    expect(patch!.patch.x).toBe(500);
    expect(api.activeGapGuides.value).toEqual([]);
  });

  it('не показывает гиды, если ни один зазор не совпал ни с одним эталоном', () => {
    const itemA = item('A', { x: 0, y: 0, width: 100, height: 100 });
    const itemB = item('B', { x: 300, y: 0, width: 100, height: 100 });
    const draggedItem = item('dragged-1', { x: 1000, y: 0, width: 100, height: 100 });

    const nodeA = flowNode(itemA, { x: 0, y: 0 }, { width: 100, height: 100 });
    const nodeB = flowNode(itemB, { x: 300, y: 0 }, { width: 100, height: 100 });
    const draggedNode = flowNode(draggedItem, { x: 1000, y: 0 }, { width: 100, height: 100 });

    const { api } = makeDrag({
      items: [itemA, itemB, draggedItem],
      flowNodes: [nodeA, nodeB, draggedNode],
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));
    api.onNodeDrag(nodeEvent([draggedNode]));

    expect(api.activeGapGuides.value).toEqual([]);
  });

  it('reset() очищает activeGapGuides', () => {
    const itemA = item('A', { x: 0, y: 0, width: 100, height: 100 });
    const itemB = item('B', { x: 300, y: 0, width: 100, height: 100 });
    const itemD = item('D', { x: 800, y: 0, width: 100, height: 100 });
    const draggedItem = item('dragged-1', { x: 498, y: 0, width: 100, height: 100 });

    const nodeA = flowNode(itemA, { x: 0, y: 0 }, { width: 100, height: 100 });
    const nodeB = flowNode(itemB, { x: 300, y: 0 }, { width: 100, height: 100 });
    const nodeD = flowNode(itemD, { x: 800, y: 0 }, { width: 100, height: 100 });
    const draggedNode = flowNode(draggedItem, { x: 498, y: 0 }, { width: 100, height: 100 });

    const { api } = makeDrag({
      items: [itemA, itemB, itemD, draggedItem],
      flowNodes: [nodeA, nodeB, nodeD, draggedNode],
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));
    api.onNodeDrag(nodeEvent([draggedNode]));
    expect(api.activeGapGuides.value.length).toBeGreaterThan(0);

    api.reset();

    expect(api.activeGapGuides.value).toEqual([]);
  });
});

describe('useBoardDragAndSnap — линейка точных расстояний (Alt/Option), 22.8', () => {
  it('без Alt — activeMeasureGuides пуст, даже если рядом есть соседи', () => {
    const staticItem = item('static-1', { x: 300, y: 0, width: 100, height: 100 });
    const draggedItem = item('dragged-1', { x: 0, y: 0, width: 100, height: 100 });
    const staticNode = flowNode(staticItem, { x: 300, y: 0 }, { width: 100, height: 100 });
    const draggedNode = flowNode(draggedItem, { x: 0, y: 0 }, { width: 100, height: 100 });

    const { api } = makeDrag({
      items: [staticItem, draggedItem],
      flowNodes: [staticNode, draggedNode],
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));
    api.onNodeDrag(nodeEvent([draggedNode]));

    expect(api.activeMeasureGuides.value).toEqual([]);
  });

  it('с зажатым Alt — показывает фактический зазор до соседа, БЕЗ порога совпадения', () => {
    // Зазор 200px — намеренно ничему не «эталонному» не совпадающий (в отличие
    // от гипотетического equal-gap кейса), Alt-режим обязан показать его всё равно.
    const staticItem = item('static-1', { x: 300, y: 0, width: 100, height: 100 });
    const draggedItem = item('dragged-1', { x: 0, y: 0, width: 100, height: 100 });
    const staticNode = flowNode(staticItem, { x: 300, y: 0 }, { width: 100, height: 100 });
    const draggedNode = flowNode(draggedItem, { x: 0, y: 0 }, { width: 100, height: 100 });

    const { api } = makeDrag({
      items: [staticItem, draggedItem],
      flowNodes: [staticNode, draggedNode],
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));
    api.onNodeDrag(nodeEvent([draggedNode], { altKey: true }));

    expect(api.activeMeasureGuides.value).toHaveLength(1);
    expect(api.activeMeasureGuides.value[0]).toMatchObject({ axis: 'horizontal', gap: 200 });
  });

  it('отпустили Alt посреди драга — activeMeasureGuides снова пуст на следующем тике', () => {
    const staticItem = item('static-1', { x: 300, y: 0, width: 100, height: 100 });
    const draggedItem = item('dragged-1', { x: 0, y: 0, width: 100, height: 100 });
    const staticNode = flowNode(staticItem, { x: 300, y: 0 }, { width: 100, height: 100 });
    const draggedNode = flowNode(draggedItem, { x: 0, y: 0 }, { width: 100, height: 100 });

    const { api } = makeDrag({
      items: [staticItem, draggedItem],
      flowNodes: [staticNode, draggedNode],
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));
    api.onNodeDrag(nodeEvent([draggedNode], { altKey: true }));
    expect(api.activeMeasureGuides.value.length).toBeGreaterThan(0);

    api.onNodeDrag(nodeEvent([draggedNode]));

    expect(api.activeMeasureGuides.value).toEqual([]);
  });

  it('очищает activeMeasureGuides на dragStop и reset()', () => {
    const staticItem = item('static-1', { x: 300, y: 0, width: 100, height: 100 });
    const draggedItem = item('dragged-1', { x: 0, y: 0, width: 100, height: 100 });
    const staticNode = flowNode(staticItem, { x: 300, y: 0 }, { width: 100, height: 100 });
    const draggedNode = flowNode(draggedItem, { x: 0, y: 0 }, { width: 100, height: 100 });

    const { api } = makeDrag({
      items: [staticItem, draggedItem],
      flowNodes: [staticNode, draggedNode],
    });

    api.onNodeDragStart(nodeEvent([draggedNode]));
    api.onNodeDrag(nodeEvent([draggedNode], { altKey: true }));
    expect(api.activeMeasureGuides.value.length).toBeGreaterThan(0);

    api.onNodeDragStop(nodeEvent([draggedNode]));
    expect(api.activeMeasureGuides.value).toEqual([]);

    api.onNodeDragStart(nodeEvent([draggedNode]));
    api.onNodeDrag(nodeEvent([draggedNode], { altKey: true }));
    expect(api.activeMeasureGuides.value.length).toBeGreaterThan(0);

    api.reset();
    expect(api.activeMeasureGuides.value).toEqual([]);
  });
});
