import type { BoardItem, BoardVotingState, BoardVotingSummary } from '@estimate/shared';
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
    number: 1,
    status: 'active',
    votesPerParticipant: 3,
    maxPerItem: 2,
    itemIds: null,
    startedAt: '2026-10-02T10:00:00.000Z',
    closedAt: null,
    myVotes: {},
    myRemaining: 3,
    votedCount: 0,
    completedCount: 0,
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
    fetchHistory: vi.fn(async (): Promise<BoardVotingSummary[]> => []),
    fetchResults: vi.fn(async (votingId: string): Promise<BoardVotingState> => ({
      ...activeState({ id: votingId, number: 1, status: 'closed' }),
      results: [{ itemId: 'a', total: 2, authors: [] }],
    })),
    remove: vi.fn(async () => {}),
  } satisfies BoardVotingCommands;
  const participants = ref(2);
  let voting!: BoardVoting;
  mount(
    defineComponent({
      setup() {
        voting = useBoardVoting({
          state: () => state.value,
          items: () => items.value,
          selectedIds: () => selected.value,
          participantCount: () => participants.value,
          commands,
        });
        return () => null;
      },
    }),
    { global: { plugins: [createAppI18n('ru')] } },
  );
  return { voting, state, items, selected, commands, participants };
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
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it('почему точку поставить нельзя — объясняет тост; подсветки на таком элементе нет', () => {
    const { voting, state, items, commands } = setup(activeState({ myRemaining: 0 }));
    voting.onNodeClick('a');
    expect(toastAdd).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Голоса закончились' }),
    );
    expect(voting.canVoteOn(items.value[0]!)).toBe(false);

    state.value = activeState({ myVotes: { a: 2 }, myRemaining: 1 });
    voting.onNodeClick('a');
    expect(toastAdd).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'На этот стикер больше нельзя' }),
    );
    expect(voting.canVoteOn(items.value[0]!)).toBe(false);
    expect(voting.canVoteOn(items.value[1]!)).toBe(true);
    expect(commands.vote).not.toHaveBeenCalled();
  });

  it('лимит на элемент больше лимита на человека упирается в меньший', () => {
    const { voting, items } = setup(
      activeState({ votesPerParticipant: 2, maxPerItem: 5, myVotes: { a: 1 }, myRemaining: 1 }),
    );
    expect(voting.canVoteOn(items.value[0]!)).toBe(true);
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

  it('«Где голосуем»: «Выделенные» доступно всегда, число выделенных — на лету', () => {
    const { voting, selected } = setup(null);
    expect(voting.scopeOptions.value[1]).toEqual({
      value: 'selected',
      label: 'Выделенные элементы',
    });
    expect(voting.selectedCount.value).toBe(0);
    expect(voting.defaultScope.value).toBe('board');

    selected.value = ['a'];
    expect(voting.scopeOptions.value[1]).toEqual({ value: 'selected', label: 'Выделенные: 1' });
    expect(voting.selectedCount.value).toBe(1);
    expect(voting.defaultScope.value).toBe('selected');
  });

  it('скоуп разворачивает группу и фрейм в элементы; галочка таймера уходит на сервер', async () => {
    const { voting, selected, commands } = setup(null);
    selected.value = ['a', 'group'];

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
      startTimer: false,
    });

    await voting.start({
      votesPerParticipant: 2,
      maxPerItem: 1,
      scope: 'frame:frame',
      startTimer: true,
    });
    expect(commands.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ itemIds: ['in-frame'], startTimer: true }),
    );

    await voting.start({
      votesPerParticipant: 2,
      maxPerItem: 1,
      scope: 'board',
      startTimer: false,
    });
    expect(commands.start).toHaveBeenLastCalledWith(expect.objectContaining({ itemIds: null }));
  });

  it('узлы: не выделяются, в скоупе — курсор-рука, вне — приглушены; кэш живёт одно голосование', () => {
    const { voting, state } = setup(activeState({ itemIds: ['a'] }));
    const nodes: Array<{ id: string; class?: unknown; selectable?: boolean }> = [
      { id: 'a' },
      { id: 'b' },
    ];

    const first = voting.decorateNodes(nodes);
    expect(first.map((n) => n.selectable)).toEqual([false, false]);
    expect(first[0]?.class).toEqual([undefined, 'board-node-voting-target']);
    expect(first[1]?.class).toEqual([undefined, 'board-node-voting-muted']);
    expect(voting.decorateNodes(nodes)[1]).toBe(first[1]);

    state.value = activeState({ id: 'v2', itemIds: ['b'] });
    expect(voting.decorateNodes(nodes)[0]?.class).toEqual([undefined, 'board-node-voting-muted']);

    // Без голосования — явный `class: undefined`: Vue Flow сливает узлы с прежними
    // (Object.assign), и узел без поля оставил бы приглушение до перезагрузки
    state.value = { ...activeState({ id: 'v2' }), status: 'closed', results: [] };
    const plain = voting.decorateNodes(nodes);
    expect(plain.map((n) => 'class' in n && n.class === undefined)).toEqual([true, true]);
    expect(plain.map((n) => n.selectable)).toEqual([undefined, undefined]);
    expect(voting.decorateNodes(nodes)[0]).toBe(plain[0]);
  });

  it('завершение на глазах открывает итоги; вход на доску с прошлыми итогами — нет', async () => {
    const closed = activeState({
      status: 'closed',
      results: [
        { itemId: 'b', total: 3, authors: [{ participantId: 'p1', name: 'Анна', count: 3 }] },
        { itemId: 'gone', total: 1, authors: [{ participantId: 'p2', name: 'Иван', count: 1 }] },
      ],
    });
    const late = setup(closed);
    expect(late.voting.hasHistory.value).toBe(true);
    expect(late.voting.hasResults.value).toBe(false);

    const { voting, state } = setup(activeState());
    state.value = closed;
    await nextTick();

    expect(voting.hasResults.value).toBe(true);
    expect(voting.resultRows.value.map((r) => [r.rank, r.text, r.total])).toEqual([
      [1, 'b', 3],
      [2, 'Без текста', 1],
    ]);
    expect(voting.summary.value).toEqual({ voters: 2, votes: 4 });

    voting.closeResults();
    expect(voting.hasResults.value).toBe(false);
  });

  it('итоги из истории открываются поверх текущих и снова закрываются', async () => {
    const { voting, commands } = setup(
      activeState({ id: 'v2', number: 2, status: 'closed', results: [] }),
    );

    await voting.openResults('v1');

    expect(commands.fetchResults).toHaveBeenCalledWith('v1');
    expect(voting.shownResults.value?.id).toBe('v1');
    expect(voting.resultRows.value.map((r) => r.itemId)).toEqual(['a']);

    // Текущее завершённое берётся из состояния, без запроса
    commands.fetchResults.mockClear();
    await voting.openResults('v2');
    expect(commands.fetchResults).not.toHaveBeenCalled();
    expect(voting.shownResults.value?.id).toBe('v2');
  });

  it('«Завершить»: если не все потратили точки — сначала подтверждение', async () => {
    const { voting, state, commands, participants } = setup(activeState({ completedCount: 1 }));
    participants.value = 3;

    await voting.finish();
    expect(voting.confirmFinishOpen.value).toBe(true);
    expect(voting.finishStats.value).toEqual({ completed: 1, total: 3 });
    expect(commands.close).not.toHaveBeenCalled();

    await voting.confirmFinish();
    expect(commands.close).toHaveBeenCalledOnce();
    expect(voting.confirmFinishOpen.value).toBe(false);

    state.value = activeState({ completedCount: 3 });
    await voting.finish();
    expect(commands.close).toHaveBeenCalledTimes(2);
  });

  it('без лимита на человека: голоса не кончаются, завершение — без подтверждения', async () => {
    const { voting, items, commands, participants } = setup(
      activeState({
        votesPerParticipant: null,
        maxPerItem: 1,
        myRemaining: null,
        myVotes: { a: 1 },
      }),
    );
    participants.value = 5;

    expect(voting.canVoteOn(items.value[0]!)).toBe(false);
    expect(voting.canVoteOn(items.value[1]!)).toBe(true);
    voting.onNodeClick('b');
    expect(commands.vote).toHaveBeenCalledWith('b', 1);

    await voting.finish();
    expect(voting.confirmFinishOpen.value).toBe(false);
    expect(commands.close).toHaveBeenCalledOnce();
  });

  it('отказ сервера на голос — тост, без исключения наружу', async () => {
    const { voting, commands } = setup();
    commands.vote.mockRejectedValueOnce(new Error('conflict'));

    voting.onNodeClick('a');
    await Promise.resolve();
    await Promise.resolve();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
  });

  it('карточку можно свернуть; новое голосование открывает её снова', async () => {
    const { voting, state } = setup();

    expect(voting.barOpen.value).toBe(true);
    voting.toggleBar();
    expect(voting.barOpen.value).toBe(false);
    state.value = activeState({ id: 'v2' });
    await nextTick();
    expect(voting.barOpen.value).toBe(true);
  });

  it('удаление голосования из итогов — после подтверждения, итоги закрываются', async () => {
    const { voting, state, commands } = setup(activeState());
    state.value = { ...activeState(), status: 'closed', results: [] };
    await nextTick();
    expect(voting.resultsOpen.value).toBe(true);

    voting.requestDelete();
    expect(voting.confirmDeleteOpen.value).toBe(true);
    await voting.confirmDelete();

    expect(commands.remove).toHaveBeenCalledWith('v1');
    expect(voting.confirmDeleteOpen.value).toBe(false);
    expect(voting.resultsOpen.value).toBe(false);
  });
});
