import type { BoardItem } from '@estimate/shared';
import { describe, expect, it } from 'vitest';
import { computed, nextTick, reactive } from 'vue';

import type { BoardSelectionNode } from '../src/features/boards/adapters/vue-flow-adapter';
import { useBoardGroupFocus } from '../src/features/boards/composables/use-board-group-focus';

function item(id: string, overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    id,
    boardId: 'board-1',
    parentId: null,
    x: 0,
    y: 0,
    width: 180,
    height: 180,
    rotation: 0,
    zIndex: 0,
    content: { type: 'sticky', text: id },
    style: { color: '#FCEB96' },
    reactions: [],
    createdBy: null,
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

function setup() {
  const items = [
    item('group', { content: { type: 'group' } }),
    item('a', { parentId: 'group' }),
    item('b', { parentId: 'group' }),
    item('frame', { content: { type: 'frame', title: '' } }),
    item('in-frame', { parentId: 'frame' }),
    item('loose'),
  ];
  const nodes = reactive(
    items.map((data) => ({ id: data.id, data, selected: false })),
  ) as unknown as BoardSelectionNode[];
  const node = (id: string) => nodes.find((candidate) => candidate.id === id)!;
  const selectedNodes = computed(() => nodes.filter((candidate) => candidate.selected));
  const selectOnlyNode = (target: BoardSelectionNode) => {
    for (const candidate of nodes) candidate.selected = candidate.id === target.id;
  };
  const focus = useBoardGroupFocus(() => nodes, selectedNodes, selectOnlyNode);
  /** Что делает сам Vue Flow по клику: выделяет только этот узел */
  const vueFlowSelect = (id: string) => selectOnlyNode(node(id));
  return { focus, node, vueFlowSelect, selectedIds: () => selectedNodes.value.map((n) => n.id) };
}

describe('useBoardGroupFocus (18.19)', () => {
  it('клик по участнику группы выделяет группу целиком', () => {
    const { focus, node, vueFlowSelect, selectedIds } = setup();
    vueFlowSelect('a');
    focus.redirectSelectionToGroup(node('a'));
    expect(selectedIds()).toEqual(['group']);
  });

  it('драг участника тоже переносит выделение на группу', () => {
    const { focus, node, vueFlowSelect, selectedIds } = setup();
    vueFlowSelect('b');
    focus.onNodeDragStart({ nodes: [node('b')] });
    expect(selectedIds()).toEqual(['group']);
  });

  it('элемент фрейма и верхнеуровневый элемент выделяются сами', () => {
    const { focus, node, vueFlowSelect, selectedIds } = setup();
    vueFlowSelect('in-frame');
    focus.redirectSelectionToGroup(node('in-frame'));
    expect(selectedIds()).toEqual(['in-frame']);
    vueFlowSelect('loose');
    focus.redirectSelectionToGroup(node('loose'));
    expect(selectedIds()).toEqual(['loose']);
  });

  it('двойной клик по участнику входит в группу и выделяет только его — событие поглощено', () => {
    const { focus, selectedIds } = setup();
    expect(focus.enterGroupOnDoubleClick('a')).toBe(true);
    expect(focus.enteredGroupId.value).toBe('group');
    expect(selectedIds()).toEqual(['a']);
  });

  it('внутри группы клики выделяют отдельные элементы, повторный двойной клик не поглощается', () => {
    const { focus, node, vueFlowSelect, selectedIds } = setup();
    focus.enterGroupOnDoubleClick('a');
    vueFlowSelect('b');
    focus.redirectSelectionToGroup(node('b'));
    expect(selectedIds()).toEqual(['b']);
    // Уже внутри — двойной клик идёт дальше, в редактирование текста
    expect(focus.enterGroupOnDoubleClick('b')).toBe(false);
  });

  it('выход из группы, когда в выделении не осталось её участников', async () => {
    const { focus, node, vueFlowSelect, selectedIds } = setup();
    focus.enterGroupOnDoubleClick('a');
    await nextTick();
    vueFlowSelect('loose');
    await nextTick();
    expect(focus.enteredGroupId.value).toBeNull();

    // Снова снаружи — клик по участнику выделяет группу
    vueFlowSelect('a');
    focus.redirectSelectionToGroup(node('a'));
    expect(selectedIds()).toEqual(['group']);
  });

  it('двойной клик по элементу вне группы не поглощается', () => {
    const { focus } = setup();
    expect(focus.enterGroupOnDoubleClick('loose')).toBe(false);
    expect(focus.enterGroupOnDoubleClick('in-frame')).toBe(false);
    expect(focus.enteredGroupId.value).toBeNull();
  });
});
