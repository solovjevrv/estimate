import type { BoardItem, BoardItemEstimate, EstimateRoomLink } from '@estimate/shared';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

import {
  estimateRoomUrl,
  useBoardEstimate,
  type BoardEstimate,
} from '../src/features/boards/composables/use-board-estimate';
import { createAppI18n } from '../src/i18n';
import { ApiError } from '../src/lib/api';

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
    updatedAt: '2026-10-07T00:00:00.000Z',
    ...over,
  };
}

function fakeTab() {
  return { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
}

function setup() {
  const selected = ref<BoardItem[]>([]);
  const estimates = ref<Record<string, BoardItemEstimate>>({});
  const canCreate = ref(true);
  const voting = { isActive: ref(false), hasResults: ref(false) };
  const tab = fakeTab();
  const openTab = vi.fn(() => tab as unknown as Window);
  const createRooms = vi.fn(
    async (_boardId: string, itemIds: string[]): Promise<EstimateRoomLink[]> =>
      itemIds.map((itemId) => ({ itemId, roomId: `room-${itemId}`, created: true })),
  );
  let estimate!: BoardEstimate;
  mount(
    defineComponent({
      setup() {
        estimate = useBoardEstimate({
          boardId: () => 'b1',
          selectedItems: () => selected.value,
          estimates: () => estimates.value,
          canCreate: () => canCreate.value,
          voting,
          createRooms,
          openTab,
        });
        return () => null;
      },
    }),
    { global: { plugins: [createAppI18n('ru')] } },
  );
  return { estimate, selected, estimates, canCreate, voting, tab, openTab, createRooms };
}

describe('useBoardEstimate (15.6)', () => {
  beforeEach(() => toastAdd.mockClear());

  it('действие: текстовые элементы — «создать», один с комнатой — «открыть», остальное — ничего', () => {
    const { estimate, selected, estimates, canCreate, voting } = setup();
    expect(estimate.action.value).toBeNull();

    selected.value = [item('a')];
    expect(estimate.action.value).toBe('create');

    estimates.value = { a: { roomId: 'r1', value: '5' } };
    expect(estimate.action.value).toBe('open');

    // Несколько — «создать»: у кого уже есть комната, тот её и получит
    selected.value = [item('a'), item('b', { content: { type: 'text', text: 'b' } })];
    expect(estimate.action.value).toBe('create');

    selected.value = [item('a'), item('e', { content: { type: 'emoji', emoji: '👍' } })];
    expect(estimate.action.value).toBeNull();

    selected.value = [item('b')];
    canCreate.value = false;
    expect(estimate.action.value).toBeNull();

    canCreate.value = true;
    voting.isActive.value = true;
    expect(estimate.action.value).toBeNull();
  });

  it('один элемент — вкладка открывается сразу в клике, потом получает адрес комнаты', async () => {
    const { estimate, selected, tab, openTab, createRooms } = setup();
    selected.value = [item('a')];

    const run = estimate.run();
    // Вкладка — синхронно, до ответа сервера: иначе браузер её заблокирует
    expect(openTab).toHaveBeenCalledTimes(1);
    await run;

    expect(createRooms).toHaveBeenCalledWith('b1', ['a']);
    expect(tab.location.href).toBe(estimateRoomUrl('room-a'));
    expect(tab.opener).toBeNull();
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it('несколько — без вкладок, тост с числом заведённых комнат', async () => {
    const { estimate, selected, openTab, createRooms } = setup();
    selected.value = [item('a'), item('b')];

    await estimate.run();

    expect(openTab).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Созданы комнаты оценки: 2' }),
    );

    createRooms.mockResolvedValueOnce([
      { itemId: 'a', roomId: 'r-a', created: false },
      { itemId: 'b', roomId: 'r-b', created: false },
    ]);
    await estimate.run();
    expect(toastAdd).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Комнаты оценки уже есть' }),
    );
  });

  it('«открыть» — комната элемента без запроса к серверу', async () => {
    const { estimate, selected, estimates, tab, createRooms } = setup();
    selected.value = [item('a')];
    estimates.value = { a: { roomId: 'r1', value: null } };

    await estimate.run();

    expect(createRooms).not.toHaveBeenCalled();
    expect(tab.location.href).toBe(estimateRoomUrl('r1'));
  });

  it('отказ сервера — вкладка закрывается, тост с причиной', async () => {
    const { estimate, selected, tab, createRooms } = setup();
    selected.value = [item('a')];
    createRooms.mockRejectedValueOnce(new ApiError(403, 'forbidden', 'Нет прав'));

    await estimate.run();

    expect(tab.close).toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Нет права заводить комнаты с этой доски', color: 'error' }),
    );
  });

  it('бейдж: пока идёт голосование точками или открыты его итоги — оценки скрыты', () => {
    const { estimate, estimates, voting } = setup();
    estimates.value = { a: { roomId: 'r1', value: '8' } };
    expect(estimate.estimateFor('a')).toEqual({ roomId: 'r1', value: '8' });
    expect(estimate.estimateFor('b')).toBeNull();

    voting.hasResults.value = true;
    expect(estimate.estimateFor('a')).toBeNull();
    voting.hasResults.value = false;
    voting.isActive.value = true;
    expect(estimate.estimateFor('a')).toBeNull();
  });
});
