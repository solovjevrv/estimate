import type { BoardItem, BoardVotingState } from '@estimate/shared';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

import {
  useBoardVoting,
  type BoardVoting,
  type BoardVotingCommands,
} from '../src/features/boards/composables/use-board-voting';
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
    zIndex: 0,
    content: { type: 'sticky', text: id },
    style: { color: '#FCEB96' },
    reactions: [],
    createdBy: null,
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...over,
  };
}

function activeState(over: Partial<BoardVotingState> = {}): BoardVotingState {
  return {
    id: 'v1',
    status: 'active',
    votesPerParticipant: 3,
    maxPerItem: 2,
    itemIds: null,
    startedAt: '2026-10-02T10:00:00.000Z',
    closedAt: null,
    myVotes: {},
    myRemaining: 3,
    votedCount: 0,
    results: null,
    ...over,
  };
}

function setup(initial: BoardVotingState | null = activeState()) {
  const state = ref<BoardVotingState | null>(initial);
  const items = ref<BoardItem[]>([
    item('a'),
    item('b'),
    item('img', { content: { type: 'emoji', emoji: '👍' } }),
    item('frame', { content: { type: 'frame', title: 'Что мешало' } }),
    item('in-frame', { parentId: 'frame' }),
    item('group', { content: { type: 'group' } }),
    item('in-group', { parentId: 'group' }),
  ]);
  const selected = ref<string[]>([]);
  const commands = {
    start: vi.fn(async () => {}),
    vote: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    startTimer: vi.fn(async () => {}),
  } satisfies BoardVotingCommands;
  let voting!: BoardVoting;
  mount(
    defineComponent({
      setup() {
        voting = useBoardVoting({
          state: () => state.value,
          items: () => items.value,
          selectedIds: () => selected.value,
          commands,
        });
        return () => null;
      },
    }),
    { global: { plugins: [createAppI18n('ru')] } },
  );
  return { voting, state, items, selected, commands };
}

describe('useBoardVoting (15.2)', () => {
  beforeEach(() => toastAdd.mockClear());

  it('без голосования клик по узлу не перехватывается', () => {
    const { voting, commands } = setup(null);

    expect(voting.onNodeClick('a')).toBe(false);
    expect(commands.vote).not.toHaveBeenCalled();
  });

  it('клик по элементу в скоупе ставит точку; вне скоупа — поглощается без голоса', () => {
    const { voting, commands } = setup(activeState({ itemIds: ['a'] }));

    expect(voting.onNodeClick('a')).toBe(true);
    expect(commands.vote).toHaveBeenCalledWith('a', 1);

    commands.vote.mockClear();
    expect(voting.onNodeClick('b')).toBe(true);
    expect(voting.onNodeClick('img')).toBe(true);
    expect(commands.vote).not.toHaveBeenCalled();
  });

  it('без оставшихся голосов — подсказка, на лимите элемента — ничего', () => {
    const { voting, state, commands } = setup(activeState({ myRemaining: 0 }));
    voting.onNodeClick('a');
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Голоса закончились' }));

    state.value = activeState({ myVotes: { a: 2 }, myRemaining: 1 });
    voting.onNodeClick('a');
    expect(commands.vote).not.toHaveBeenCalled();
  });

  it('снять точку можно только свою и только во время голосования', () => {
    const { voting, state, commands } = setup(activeState({ myVotes: { a: 1 } }));
    voting.removeVote('b');
    voting.removeVote('a');
    expect(commands.vote).toHaveBeenCalledExactlyOnceWith('a', -1);

    state.value = { ...activeState({ myVotes: { a: 1 } }), status: 'closed', results: [] };
    voting.removeVote('a');
    expect(commands.vote).toHaveBeenCalledOnce();
  });

  it('скоуп «Выделенные» разворачивает группу в участников, фрейм — в свои элементы', async () => {
    const { voting, selected, commands } = setup(null);
    selected.value = ['a', 'group'];
    expect(voting.defaultScope.value).toBe('selected');
    expect(voting.scopeOptions.value.map((o) => o.label)).toEqual([
      'Вся доска',
      'Выделенные: 2',
      'Что мешало',
    ]);

    await voting.start({
      votesPerParticipant: 3,
      maxPerItem: 3,
      scope: 'selected',
      startTimer: false,
    });
    expect(commands.start).toHaveBeenLastCalledWith({
      votesPerParticipant: 3,
      maxPerItem: 3,
      itemIds: ['a', 'group', 'in-group'],
    });
    expect(commands.startTimer).not.toHaveBeenCalled();

    await voting.start({
      votesPerParticipant: 2,
      maxPerItem: 1,
      scope: 'frame:frame',
      startTimer: true,
    });
    expect(commands.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ itemIds: ['in-frame'] }),
    );
    expect(commands.startTimer).toHaveBeenCalledOnce();

    await voting.start({
      votesPerParticipant: 2,
      maxPerItem: 1,
      scope: 'board',
      startTimer: false,
    });
    expect(commands.start).toHaveBeenLastCalledWith(expect.objectContaining({ itemIds: null }));
  });

  it('во время голосования узлы не выделяются, вне скоупа — приглушены; кэш живёт одно голосование', () => {
    const { voting, state } = setup(activeState({ itemIds: ['a'] }));
    const nodes: Array<{ id: string; class?: unknown; selectable?: boolean }> = [
      { id: 'a' },
      { id: 'b' },
    ];

    const first = voting.decorateNodes(nodes);
    expect(first.map((n) => n.selectable)).toEqual([false, false]);
    expect(first[0]).not.toHaveProperty('class');
    expect(first[1]?.class).toEqual([undefined, 'board-node-voting-muted']);
    expect(voting.decorateNodes(nodes)[1]).toBe(first[1]);

    state.value = activeState({ id: 'v2', itemIds: ['b'] });
    const second = voting.decorateNodes(nodes);
    expect(second[1]).not.toHaveProperty('class');
    expect(second[0]?.class).toEqual([undefined, 'board-node-voting-muted']);

    state.value = null;
    expect(voting.decorateNodes(nodes)).toBe(nodes);
  });

  it('итоги: строки с текстом и цветом элемента, сводка, панель открывается сама', async () => {
    const { voting, state } = setup(null);
    expect(voting.resultsOpen.value).toBe(false);

    state.value = activeState({
      status: 'closed',
      results: [
        { itemId: 'b', total: 3, authors: [{ participantId: 'p1', name: 'Анна', count: 3 }] },
        {
          itemId: 'gone',
          total: 1,
          authors: [{ participantId: 'p2', name: 'Иван', count: 1 }],
        },
      ],
    });
    await nextTick();

    expect(voting.resultsOpen.value).toBe(true);
    expect(voting.resultRows.value.map((r) => [r.rank, r.text, r.total])).toEqual([
      [1, 'b', 3],
      [2, 'Без текста', 1],
    ]);
    expect(voting.summary.value).toEqual({ voters: 2, votes: 4 });

    voting.closeResults();
    expect(voting.resultsOpen.value).toBe(false);
    voting.toggleResults();
    expect(voting.resultsOpen.value).toBe(true);
  });

  it('отказ сервера на голос — тост, без исключения наружу', async () => {
    const { voting, commands } = setup();
    commands.vote.mockRejectedValueOnce(new Error('conflict'));

    voting.onNodeClick('a');
    await Promise.resolve();
    await Promise.resolve();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
  });
});
