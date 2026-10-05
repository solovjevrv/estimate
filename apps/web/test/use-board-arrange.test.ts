import type { BoardItem, BoardItemPatchOp, BoardOp, BoardVotingState } from '@estimate/shared';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

import {
  useBoardArrange,
  type BoardArrange,
} from '../src/features/boards/composables/use-board-arrange';
import { ARRANGE_OUTSIDE_OFFSET } from '../src/features/boards/domain/board-arrange';
import { createAppI18n } from '../src/i18n';

const toastAdd = vi.fn();
vi.mock('@nuxt/ui/composables', () => ({
  useToast: () => ({ add: toastAdd, remove: vi.fn() }),
}));

function item(id: string, over: Partial<BoardItem> = {}): BoardItem {
  return {
    id,
    boardId: 'b1',
    parentId: null,
    x: 0,
    y: 0,
    width: 180,
    height: 180,
    rotation: 0,
    zIndex: 1,
    content: { type: 'sticky', text: id },
    style: { color: '#FCEB96' },
    reactions: [],
    createdBy: null,
    updatedAt: '2026-10-04T00:00:00.000Z',
    ...over,
  };
}

function closedVoting(over: Partial<BoardVotingState> = {}): BoardVotingState {
  return {
    id: 'v1',
    number: 1,
    status: 'closed',
    votesPerParticipant: 3,
    maxPerItem: null,
    itemIds: null,
    startedAt: '2026-10-04T10:00:00.000Z',
    closedAt: '2026-10-04T10:05:00.000Z',
    myVotes: {},
    myRemaining: null,
    votedCount: 2,
    completedCount: 0,
    results: [
      { itemId: 'b', total: 4, authors: [] },
      { itemId: 'a', total: 1, authors: [] },
    ],
    ...over,
  };
}

function setup() {
  const items = ref<BoardItem[]>([
    item('a', { x: 0, y: 0 }),
    item('b', { x: 300, y: 0, style: { color: '#69DFCD' }, createdBy: 'anna' }),
    item('c', { x: 600, y: 0 }),
    item('emoji', { x: 900, content: { type: 'emoji', emoji: '👍' } }),
    item('group', { x: 0, y: 500, content: { type: 'group' } }),
    item('in-group', { x: 0, y: 500, parentId: 'group' }),
  ]);
  const selected = ref<string[]>([]);
  const isActive = ref(false);
  const hasResults = ref(false);
  const shownResults = ref<BoardVotingState | null>(null);
  const canEdit = ref(true);
  const history: { top: unknown } = { top: undefined };
  const applyOps = vi.fn(async (ops: BoardOp[]) => {
    history.top = ops;
    return 1;
  });
  const undo = vi.fn(async () => {});
  const selectItems = vi.fn();
  const clearSelection = vi.fn();
  const reveal = vi.fn();
  const canApplyOpsCount = vi.fn(() => true);
  let arrange!: BoardArrange;
  mount(
    defineComponent({
      setup() {
        arrange = useBoardArrange({
          items: () => items.value,
          selectedItems: () => items.value.filter((i) => selected.value.includes(i.id)),
          voting: { isActive, hasResults, shownResults },
          authorNames: () => new Map([['anna', 'Анна Крылова']]),
          canEdit: () => canEdit.value,
          canApplyOpsCount,
          history: { applyOps, peekUndo: () => history.top, undo },
          selectItems,
          clearSelection,
          reveal,
        });
        return () => null;
      },
    }),
    { global: { plugins: [createAppI18n('ru')] } },
  );
  return {
    arrange,
    items,
    selected,
    isActive,
    hasResults,
    shownResults,
    canEdit,
    history,
    applyOps,
    undo,
    selectItems,
    clearSelection,
    reveal,
    canApplyOpsCount,
  };
}

const patchesOf = (ops: BoardOp[]) =>
  ops.filter((op): op is BoardItemPatchOp => op.type === 'item.patch');

describe('useBoardArrange (15.4)', () => {
  beforeEach(() => toastAdd.mockClear());

  it('«Разложить» — 2+ текстовых элемента, право правки, голосование не идёт', () => {
    const ctx = setup();

    ctx.selected.value = ['a'];
    expect(ctx.arrange.canArrangeSelection.value).toBe(false);
    ctx.selected.value = ['a', 'b'];
    expect(ctx.arrange.canArrangeSelection.value).toBe(true);
    ctx.selected.value = ['a', 'emoji'];
    expect(ctx.arrange.canArrangeSelection.value).toBe(false);
    ctx.selected.value = ['a', 'in-group'];
    expect(ctx.arrange.canArrangeSelection.value).toBe(false);
    ctx.selected.value = ['a', 'b'];
    ctx.isActive.value = true;
    expect(ctx.arrange.canArrangeSelection.value).toBe(false);
    ctx.isActive.value = false;
    ctx.canEdit.value = false;
    expect(ctx.arrange.canArrangeSelection.value).toBe(false);
  });

  it('выделенный фрейм — значит его текстовые элементы (повторная раскладка)', () => {
    const ctx = setup();
    ctx.items.value = [
      ...ctx.items.value,
      item('frame', { x: 0, y: 900, content: { type: 'frame', title: 'Жёлтые · 2' } }),
      item('k1', { parentId: 'frame', x: 24, y: 924 }),
      item('k2', { parentId: 'frame', x: 228, y: 924, createdBy: 'anna' }),
    ];
    ctx.selected.value = ['frame'];

    expect(ctx.arrange.canArrangeSelection.value).toBe(true);
    ctx.arrange.arrangeSelection('author');

    const ops = ctx.applyOps.mock.calls[0]![0];
    // Старый фрейм опустел — удаляется первым, стикеры разложены по авторам
    expect(ops[0]).toMatchObject({ type: 'item.delete', id: 'frame' });
    expect(
      patchesOf(ops)
        .map((op) => op.id)
        .sort(),
    ).toEqual(['k1', 'k2']);
  });

  it('«По голосам» в меню — только при открытых итогах с точками у выделенного', () => {
    const ctx = setup();
    ctx.selected.value = ['a', 'c'];

    expect(ctx.arrange.canArrangeSelectionByVotes.value).toBe(false);
    ctx.shownResults.value = closedVoting();
    ctx.hasResults.value = true;
    expect(ctx.arrange.canArrangeSelectionByVotes.value).toBe(true);
    ctx.selected.value = ['c', 'emoji'];
    expect(ctx.arrange.canArrangeSelectionByVotes.value).toBe(false);
  });

  it('по цвету: фреймы, выделяются после раскладки, тост с «Отменить»', async () => {
    const ctx = setup();
    ctx.selected.value = ['a', 'b', 'c'];

    ctx.arrange.arrangeSelection('color');
    await nextTick();

    const ops = ctx.applyOps.mock.calls[0]![0];
    const frames = ops.filter((op) => op.type === 'item.create');
    expect(frames.map((op) => op.type === 'item.create' && op.item.content)).toEqual([
      { type: 'frame', title: 'Жёлтые · 2' },
      { type: 'frame', title: 'Мятные · 1' },
    ]);
    expect(ctx.selectItems).toHaveBeenCalledWith(
      frames.map((op) => op.type === 'item.create' && op.item.id),
    );
    expect(ctx.reveal).toHaveBeenCalledOnce();
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Разложено по цвету', close: false }),
    );
  });

  it('по автору: справочник имён, гости отдельной кучкой', () => {
    const ctx = setup();
    ctx.selected.value = ['a', 'b', 'c'];

    ctx.arrange.arrangeSelection('author');

    const titles = ctx.applyOps.mock.calls[0]![0].filter((op) => op.type === 'item.create').map(
      (op) => op.type === 'item.create' && op.item.content,
    );
    // Гости последними, даже когда их кучка больше
    expect(titles).toEqual([
      { type: 'frame', title: 'Анна Крылова · 1' },
      { type: 'frame', title: 'Гости · 2' },
    ]);
  });

  it('«Отменить» в тосте откатывает раскладку, но не чужое действие после неё', async () => {
    const ctx = setup();
    ctx.selected.value = ['a', 'b'];
    ctx.arrange.arrangeSelection('color');
    const action = toastAdd.mock.calls[0]![0].actions[0];

    ctx.history.top = 'другое действие';
    action.onClick();
    expect(ctx.undo).not.toHaveBeenCalled();

    ctx.history.top = ctx.applyOps.mock.calls[0]![0];
    action.onClick();
    expect(ctx.undo).toHaveBeenCalledOnce();
  });

  it('итоги по всей доске: только элементы с точками, правее всего содержимого', () => {
    const ctx = setup();
    ctx.shownResults.value = closedVoting();
    ctx.hasResults.value = true;

    expect(ctx.arrange.canArrangeResults.value).toBe(true);
    ctx.arrange.arrangeResults();

    const ops = patchesOf(ctx.applyOps.mock.calls[0]![0]);
    expect(ops.map((op) => op.id)).toEqual(['b', 'a']);
    // Правый край содержимого — эмодзи: 900 + 180
    expect(ops[0]?.patch).toMatchObject({ x: 1080 + ARRANGE_OUTSIDE_OFFSET, y: 0 });
    expect(ctx.clearSelection).toHaveBeenCalled();
  });

  it('итоги по выделенным: весь скоуп на месте, без точек — в конце', () => {
    const ctx = setup();
    ctx.shownResults.value = closedVoting({ itemIds: ['a', 'b', 'c'] });
    ctx.hasResults.value = true;

    ctx.arrange.arrangeResults();

    const ops = patchesOf(ctx.applyOps.mock.calls[0]![0]);
    expect(ops.map((op) => op.id)).toEqual(['b', 'a', 'c']);
    expect(ops[0]?.patch).toMatchObject({ x: 0, y: 0 });
  });

  it('пока идёт голосование или нет права — из итогов не выстраивается', () => {
    const ctx = setup();
    ctx.shownResults.value = closedVoting();
    ctx.hasResults.value = true;
    ctx.isActive.value = true;

    expect(ctx.arrange.canArrangeResults.value).toBe(false);
    ctx.isActive.value = false;
    ctx.canEdit.value = false;
    expect(ctx.arrange.canArrangeResults.value).toBe(false);
    ctx.arrange.arrangeResults();
    expect(ctx.applyOps).not.toHaveBeenCalled();
  });

  it('сверх лимита батча — ничего не применяется', () => {
    const ctx = setup();
    ctx.canApplyOpsCount.mockReturnValue(false);
    ctx.selected.value = ['a', 'b'];

    ctx.arrange.arrangeSelection('color');

    expect(ctx.applyOps).not.toHaveBeenCalled();
    expect(toastAdd).not.toHaveBeenCalled();
  });
});
