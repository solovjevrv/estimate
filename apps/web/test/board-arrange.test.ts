import type { BoardItem, BoardItemCreateOp, BoardItemPatchOp } from '@estimate/shared';
import { describe, expect, it } from 'vitest';

import {
  ARRANGE_FRAME_GAP,
  ARRANGE_FRAME_PADDING,
  ARRANGE_GAP,
  ARRANGE_SORT_COLUMNS,
  clusterColumns,
  clusterPlan,
  groupByAuthor,
  groupByColor,
  orderByVotes,
  readingOrder,
  sortPlan,
  votesPlan,
} from '../src/features/boards/domain/board-arrange';

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

const patches = (ops: unknown[]) =>
  ops.filter((op) => (op as BoardItemPatchOp).type === 'item.patch') as BoardItemPatchOp[];
const creates = (ops: unknown[]) =>
  ops.filter((op) => (op as BoardItemCreateOp).type === 'item.create') as BoardItemCreateOp[];

describe('readingOrder', () => {
  it('сверху вниз, в ряду слева направо — с допуском по высоте', () => {
    const items = [
      item('right', { x: 400, y: 10 }),
      item('below', { x: 0, y: 300 }),
      item('left', { x: 0, y: 0 }),
    ];

    expect(readingOrder(items).map((i) => i.id)).toEqual(['left', 'right', 'below']);
  });
});

describe('orderByVotes', () => {
  it('по убыванию точек, без точек — в конце в порядке чтения', () => {
    const items = [
      item('none-2', { x: 400 }),
      item('three', { x: 200, y: 300 }),
      item('none-1', { x: 0 }),
      item('five', { x: 0, y: 600 }),
    ];
    const totals = new Map([
      ['three', 3],
      ['five', 5],
    ]);

    expect(orderByVotes(items, totals).map((i) => i.id)).toEqual([
      'five',
      'three',
      'none-1',
      'none-2',
    ]);
  });
});

describe('sortPlan', () => {
  it('сетка по 5 в ряд от origin, лидер в левом верхнем углу', () => {
    const ordered = Array.from({ length: 6 }, (_, i) => item(`s${i}`, { x: 1000 + i, y: 1000 }));
    const plan = sortPlan({ ordered, origin: { x: 100, y: 50 }, boardItems: ordered });
    const step = 180 + ARRANGE_GAP;

    const byId = new Map(patches(plan.ops).map((op) => [op.id, op.patch]));
    expect(byId.get('s0')).toEqual({ x: 100, y: 50, parentId: null });
    expect(byId.get('s4')).toEqual({ x: 100 + 4 * step, y: 50, parentId: null });
    expect(byId.get('s5')).toEqual({ x: 100, y: 50 + step, parentId: null });
    expect(plan.bounds).toEqual({
      x: 100,
      y: 50,
      width: ARRANGE_SORT_COLUMNS * 180 + 4 * ARRANGE_GAP,
      height: 2 * 180 + ARRANGE_GAP,
    });
    expect(plan.frameIds).toEqual([]);
  });

  it('родитель — фрейм под новым местом: уехавший из фрейма отвязывается', () => {
    const frame = item('frame', {
      x: 0,
      y: 0,
      width: 500,
      height: 300,
      content: { type: 'frame', title: '' },
    });
    const inside = item('inside', { parentId: 'frame', x: 20, y: 20 });
    const outside = item('outside', { parentId: 'frame', x: 220, y: 20 });
    const far = item('far', { parentId: 'frame', x: 400, y: 20 });
    const plan = sortPlan({
      ordered: [inside, outside, far],
      origin: { x: 20, y: 20 },
      boardItems: [frame, inside, outside, far],
    });

    const parents = patches(plan.ops).map((op) => [op.id, op.patch.parentId]);
    // Третий встаёт в x=20+2*204=428 — центр 518, за правым краем фрейма (500)
    expect(parents).toEqual([
      ['inside', 'frame'],
      ['outside', 'frame'],
      ['far', null],
    ]);
  });
});

describe('votesPlan', () => {
  const frameAt = (id: string, x: number): BoardItem =>
    item(id, { x, y: 0, width: 228, height: 228, content: { type: 'frame', title: id } });

  it('после раскладки по цвету — каждый стикер остаётся в своём фрейме', () => {
    // Четыре фрейма по одному стикеру (как «Жёлтые · 1», «Персиковые · 1»…)
    const frames = ['f1', 'f2', 'f3', 'f4'].map((id, i) => frameAt(id, i * 300));
    const stickies = frames.map((frame, i) =>
      item(`s${i}`, { parentId: frame.id, x: frame.x + 24, y: 24 }),
    );
    const plan = votesPlan({
      items: stickies,
      totals: new Map([
        ['s0', 1],
        ['s2', 1],
      ]),
      boardItems: [...frames, ...stickies],
    });

    const byId = new Map(patches(plan.ops).map((op) => [op.id, op.patch]));
    stickies.forEach((sticky) => {
      // Позиция внутри своего фрейма, родитель не трогается
      expect(byId.get(sticky.id)).toEqual({ x: sticky.x, y: 24 });
    });
    // Фреймы на месте и того же размера — патчей на них нет
    frames.forEach((frame) => expect(byId.has(frame.id)).toBe(false));
  });

  it('внутри фрейма — по убыванию точек сеткой кучки; тесный фрейм расширяется', () => {
    const frame = frameAt('f', 0);
    const kids = ['a', 'b', 'c'].map((id, i) => item(id, { parentId: 'f', x: 24 + i, y: 24 }));
    const plan = votesPlan({
      items: [kids[0]!],
      totals: new Map([['c', 5]]),
      boardItems: [frame, ...kids],
    });

    const ordered = patches(plan.ops).filter((op) => op.id !== 'f');
    expect(ordered.map((op) => op.id)).toEqual(['c', 'a', 'b']);
    expect(ordered[0]?.patch).toEqual({ x: 24, y: 24 });
    const grow = patches(plan.ops).find((op) => op.id === 'f');
    const side = 2 * 180 + ARRANGE_GAP + 2 * ARRANGE_FRAME_PADDING;
    expect(grow?.patch).toEqual({ width: side, height: side });
  });

  it('свободные, чья сетка легла бы на фрейм, встают правее задействованного', () => {
    const frame = frameAt('f', 300);
    const inFrame = item('in', { parentId: 'f', x: 324, y: 24 });
    const loose = [item('l1', { x: 0, y: 0 }), item('l2', { x: 0, y: 300 })];
    const plan = votesPlan({
      items: [inFrame, ...loose],
      totals: new Map(),
      boardItems: [frame, inFrame, ...loose],
    });

    const first = patches(plan.ops).find((op) => op.id === 'l1');
    expect(first?.patch).toEqual({ x: 300 + 228 + ARRANGE_FRAME_GAP, y: 0, parentId: null });
  });
});

describe('clusterPlan', () => {
  it('колонок — корень из числа, округлённый вверх', () => {
    expect([1, 3, 4, 5, 9, 10].map(clusterColumns)).toEqual([1, 2, 2, 3, 3, 4]);
  });

  it('фрейм на кучку: заголовок с числом, размер по сетке, дети внутри, фреймы в ряд', () => {
    const plan = clusterPlan({
      groups: [
        { key: 'y', title: 'Жёлтые', items: ['a', 'b', 'c', 'd'].map((id) => item(id)) },
        { key: 'm', title: 'Мятные', items: [item('e')] },
      ],
      origin: { x: 10, y: 20 },
      frameZIndex: -5,
      frameColor: (group) => (group.key === 'y' ? '#FCEB96' : '#69DFCD'),
      boardItems: [],
    });

    const [yellow, mint] = creates(plan.ops);
    const side = 2 * 180 + ARRANGE_GAP + 2 * ARRANGE_FRAME_PADDING;
    expect(yellow?.item).toMatchObject({
      x: 10,
      y: 20,
      width: side,
      height: side,
      zIndex: -5,
      parentId: null,
      content: { type: 'frame', title: 'Жёлтые · 4' },
      style: { color: '#FCEB96' },
    });
    expect(mint?.item).toMatchObject({
      x: 10 + side + ARRANGE_FRAME_GAP,
      content: { type: 'frame', title: 'Мятные · 1' },
      style: { color: '#69DFCD' },
    });
    expect(plan.frameIds).toEqual([yellow?.item.id, mint?.item.id]);

    const byId = new Map(patches(plan.ops).map((op) => [op.id, op.patch]));
    const inner = { x: 10 + ARRANGE_FRAME_PADDING, y: 20 + ARRANGE_FRAME_PADDING };
    expect(byId.get('a')).toEqual({ ...inner, parentId: yellow?.item.id });
    expect(byId.get('d')).toEqual({
      x: inner.x + 180 + ARRANGE_GAP,
      y: inner.y + 180 + ARRANGE_GAP,
      parentId: yellow?.item.id,
    });
    expect(byId.get('e')?.parentId).toBe(mint?.item.id);
    // Фреймы создаются раньше, чем на них ссылаются дети — сервер применяет батч по порядку
    expect(plan.ops[0]?.type).toBe('item.create');
  });
});

describe('clusterPlan: повторная раскладка', () => {
  const frame = (id: string, x: number): BoardItem =>
    item(id, { x, width: 228, height: 228, content: { type: 'frame', title: `${id} · 1` } });
  const deletes = (ops: unknown[]) =>
    (ops as { type: string; id?: string }[]).filter((op) => op.type === 'item.delete');

  it('та же кучка в своём фрейме — фрейм переиспользуется, дубликатов нет', () => {
    const f1 = frame('f1', 0);
    const f2 = frame('f2', 300);
    const a = item('a', { parentId: 'f1', x: 24, y: 24 });
    const b = item('b', { parentId: 'f2', x: 324, y: 24 });

    const plan = clusterPlan({
      groups: [
        { key: 'y', title: 'Жёлтые', items: [a] },
        { key: 'p', title: 'Персиковые', items: [b] },
      ],
      origin: { x: 0, y: 0 },
      frameZIndex: 0,
      frameColor: () => '#FCEB96',
      boardItems: [f1, f2, a, b],
    });

    expect(creates(plan.ops)).toHaveLength(0);
    expect(deletes(plan.ops)).toHaveLength(0);
    expect(plan.frameIds).toEqual(['f1', 'f2']);
    const byId = new Map(patches(plan.ops).map((op) => [op.id, op.patch]));
    expect(byId.get('f1')).toMatchObject({ content: { type: 'frame', title: 'Жёлтые · 1' } });
    expect(byId.get('a')).toEqual({ x: 24, y: 24, parentId: 'f1' });
  });

  it('другая раскладка — опустевшие фреймы удаляются, удаления первыми в батче', () => {
    const f1 = frame('f1', 0);
    const f2 = frame('f2', 300);
    const a = item('a', { parentId: 'f1', x: 24, y: 24, createdBy: 'anna' });
    const b = item('b', { parentId: 'f2', x: 324, y: 24, createdBy: 'anna' });

    const plan = clusterPlan({
      groups: [{ key: 'anna', title: 'Анна', items: [a, b] }],
      origin: { x: 0, y: 0 },
      frameZIndex: 0,
      frameColor: () => '#FCEB96',
      boardItems: [f1, f2, a, b],
    });

    expect(plan.ops.slice(0, 2)).toEqual([
      expect.objectContaining({ type: 'item.delete', id: 'f1' }),
      expect.objectContaining({ type: 'item.delete', id: 'f2' }),
    ]);
    expect(creates(plan.ops)).toHaveLength(1);
  });

  it('смешанная повторная раскладка — фреймы в ряд заново, без наложений', () => {
    // Было: «Жёлтые · 1» (a) и «Персиковые · 1» (b); c — ещё один жёлтый, свободный
    const f1 = frame('f1', 0);
    const f2 = frame('f2', 300);
    const a = item('a', { parentId: 'f1', x: 24, y: 24 });
    const b = item('b', { parentId: 'f2', x: 324, y: 24, style: { color: '#FCB97D' } });
    const c = item('c', { x: 700, y: 24 });

    const plan = clusterPlan({
      groups: [
        { key: 'y', title: 'Жёлтые', items: [a, c] },
        { key: 'p', title: 'Персиковые', items: [b] },
      ],
      origin: { x: 0, y: 0 },
      frameZIndex: 0,
      frameColor: () => '#FCEB96',
      boardItems: [f1, f2, a, b, c],
    });

    expect(deletes(plan.ops).map((op) => op.id)).toEqual(['f1']);
    const yellow = creates(plan.ops)[0]!.item;
    const peach = patches(plan.ops).find((op) => op.id === 'f2')!.patch;
    expect(yellow).toMatchObject({ x: 0, y: 0 });
    // Персиковый фрейм переехал правее жёлтого, а не остался поперёк ряда
    expect(peach.x).toBe(yellow.width + ARRANGE_FRAME_GAP);
    expect(peach.content).toEqual({ type: 'frame', title: 'Персиковые · 1' });
  });

  it('фрейм с чужими элементами не удаляется', () => {
    const f1 = frame('f1', 0);
    const a = item('a', { parentId: 'f1', x: 24, y: 24 });
    const other = item('other', { parentId: 'f1', x: 100, y: 100 });

    const plan = clusterPlan({
      groups: [{ key: 'y', title: 'Жёлтые', items: [a] }],
      origin: { x: 0, y: 0 },
      frameZIndex: 0,
      frameColor: () => '#FCEB96',
      boardItems: [f1, a, other],
    });

    expect(deletes(plan.ops)).toHaveLength(0);
    expect(creates(plan.ops)).toHaveLength(1);
  });
});

describe('groupByColor', () => {
  it('большие кучки первыми, равные — в порядке палитры; цвет вне палитры — по hex', () => {
    const items = [
      item('pink', { style: { color: '#ffb8e8' } }),
      item('mint-1', { style: { color: '#69DFCD' } }),
      item('mint-2', { style: { color: '#69dfcd' } }),
      item('yellow', { style: { color: '#FCEB96' } }),
      item('custom', { style: { color: '#123456' } }),
    ];

    const groups = groupByColor(items, (index) => `палитра-${index}`);

    expect(groups.map((g) => [g.title, g.items.length])).toEqual([
      ['палитра-7', 2],
      ['палитра-1', 1],
      ['палитра-8', 1],
      ['#123456', 1],
    ]);
  });
});

describe('groupByAuthor', () => {
  it('по автору, гости — последней кучкой, автор без имени — «Участник»', () => {
    const items = [
      item('g1'),
      item('g2'),
      item('g3'),
      item('anna-1', { createdBy: 'anna' }),
      item('ivan-1', { createdBy: 'ivan' }),
      item('anna-2', { createdBy: 'anna' }),
      item('gone', { createdBy: 'deleted' }),
    ];

    const groups = groupByAuthor(
      items,
      new Map([
        ['anna', 'Анна Крылова'],
        ['ivan', 'Иван Петров'],
      ]),
      { guests: 'Гости', unknownName: 'Участник' },
    );

    expect(groups.map((g) => [g.title, g.items.length])).toEqual([
      ['Анна Крылова', 2],
      ['Иван Петров', 1],
      ['Участник', 1],
      ['Гости', 3],
    ]);
  });
});
