import type { BoardEdge, BoardItem, BoardOp } from '@poker/shared';
import { describe, expect, it } from 'vitest';

import type { BoardLocalState } from '../src/features/boards/domain/apply-local-op';
import {
  deriveInverseOps,
  filterExistingTargets,
  regenerateClientOpIds,
} from '../src/features/boards/domain/board-op-history';

function state(items: BoardItem[] = [], edges: BoardEdge[] = []): BoardLocalState {
  return {
    items: new Map(items.map((item) => [item.id, item])),
    edges: new Map(edges.map((edge) => [edge.id, edge])),
  };
}

function item(over: Partial<BoardItem> = {}): BoardItem {
  return {
    id: 'i1',
    boardId: 'b1',
    parentId: null,
    x: 10,
    y: 20,
    width: 160,
    height: 120,
    rotation: 0,
    zIndex: 0,
    content: { type: 'sticky', text: 'Привет' },
    style: { color: '#FCEB96' },
    reactions: [],
    createdBy: 'u1',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...over,
  };
}

function edge(over: Partial<BoardEdge> = {}): BoardEdge {
  return {
    id: 'e1',
    boardId: 'b1',
    sourceItemId: 'i1',
    targetItemId: 'i2',
    sourceHandle: null,
    targetHandle: null,
    label: null,
    style: { color: '#A8CAFF', line: 'straight', dash: 'solid', markerStart: 'none', markerEnd: 'none' },
    ...over,
  };
}

describe('deriveInverseOps', () => {
  it('item.create → item.delete по тому же id', () => {
    const op: BoardOp = { type: 'item.create', clientOpId: 'c1', item: item() };

    const [inverse] = deriveInverseOps([op], state());

    expect(inverse).toMatchObject({ type: 'item.delete', id: 'i1' });
  });

  it('item.delete → item.create с полным снимком элемента', () => {
    const existing = item({ x: 500, style: { color: '#FCEB96', fontSize: 30 } });
    const op: BoardOp = { type: 'item.delete', clientOpId: 'c1', id: 'i1' };

    const [inverse] = deriveInverseOps([op], state([existing]));

    expect(inverse).toMatchObject({ type: 'item.create', item: existing });
  });

  it('item.delete восстанавливает каскадно удаляемые связи вместе с элементом', () => {
    const it1 = item({ id: 'i1' });
    const it2 = item({ id: 'i2' });
    const e = edge({ id: 'e1', sourceItemId: 'i1', targetItemId: 'i2' });
    const other = edge({ id: 'e2', sourceItemId: 'i2', targetItemId: 'i3' });
    const op: BoardOp = { type: 'item.delete', clientOpId: 'c1', id: 'i1' };

    const inverses = deriveInverseOps([op], state([it1, it2], [e, other]));

    expect(inverses).toEqual([
      expect.objectContaining({ type: 'item.create', item: it1 }),
      expect.objectContaining({ type: 'edge.create', edge: e }),
    ]);
  });

  it('удаление обоих концов связи одним батчем не дублирует её восстановление', () => {
    const it1 = item({ id: 'i1' });
    const it2 = item({ id: 'i2' });
    const e = edge({ id: 'e1', sourceItemId: 'i1', targetItemId: 'i2' });
    const ops: BoardOp[] = [
      { type: 'item.delete', clientOpId: 'c1', id: 'i1' },
      { type: 'item.delete', clientOpId: 'c2', id: 'i2' },
    ];

    const inverses = deriveInverseOps(ops, state([it1, it2], [e]));

    const edgeCreates = inverses.filter((op) => op.type === 'edge.create');
    expect(edgeCreates).toHaveLength(1);
  });

  it('удаление обоих связанных элементов одним батчем ставит оба item.create ПЕРЕД edge.create', () => {
    // Регрессия: сервер применяет батч строго по порядку и отклоняет edge.create,
    // ссылающийся на ещё не созданный на этом шаге элемент — целиком весь батч
    const it1 = item({ id: 'i1' });
    const it2 = item({ id: 'i2' });
    const e = edge({ id: 'e1', sourceItemId: 'i1', targetItemId: 'i2' });
    const ops: BoardOp[] = [
      { type: 'item.delete', clientOpId: 'c1', id: 'i1' },
      { type: 'item.delete', clientOpId: 'c2', id: 'i2' },
    ];

    const inverses = deriveInverseOps(ops, state([it1, it2], [e]));

    const edgeCreateIndex = inverses.findIndex((op) => op.type === 'edge.create');
    const itemCreateIndexes = inverses
      .map((op, index) => (op.type === 'item.create' ? index : -1))
      .filter((index) => index !== -1);
    expect(itemCreateIndexes).toHaveLength(2);
    expect(Math.max(...itemCreateIndexes)).toBeLessThan(edgeCreateIndex);
  });

  it('item.delete одного конца + явный edge.delete той же связи в одном батче не дублирует edge.create', () => {
    const it1 = item({ id: 'i1' });
    const it2 = item({ id: 'i2' });
    const e = edge({ id: 'e1', sourceItemId: 'i1', targetItemId: 'i2' });
    const ops: BoardOp[] = [
      { type: 'item.delete', clientOpId: 'c1', id: 'i1' },
      { type: 'edge.delete', clientOpId: 'c2', id: 'e1' },
    ];

    const inverses = deriveInverseOps(ops, state([it1, it2], [e]));

    expect(inverses.filter((op) => op.type === 'edge.create')).toHaveLength(1);
  });

  it('item.patch → инверс-патч только по тронутым полям, старым style-полям тоже', () => {
    const existing = item({ x: 100, y: 200, style: { color: '#FCEB96', fontSize: 24 } });
    const op: BoardOp = {
      type: 'item.patch',
      clientOpId: 'c1',
      id: 'i1',
      patch: { x: 500, style: { color: '#A8CAFF' } },
    };

    const [inverse] = deriveInverseOps([op], state([existing]));

    expect(inverse).toMatchObject({
      type: 'item.patch',
      id: 'i1',
      patch: { x: 100, style: { color: '#FCEB96' } },
    });
    // fontSize не был в патче — инверсия его не трогает (не переносит в patch.style)
    expect((inverse as { patch: { style?: object } }).patch.style).not.toHaveProperty('fontSize');
  });

  it('item.patch на уже удалённую другим участником цель — инверсия пустая', () => {
    const op: BoardOp = { type: 'item.patch', clientOpId: 'c1', id: 'missing', patch: { x: 1 } };

    expect(deriveInverseOps([op], state())).toEqual([]);
  });

  it('edge.create → edge.delete по тому же id', () => {
    const op: BoardOp = { type: 'edge.create', clientOpId: 'c1', edge: edge() };

    const [inverse] = deriveInverseOps([op], state());

    expect(inverse).toMatchObject({ type: 'edge.delete', id: 'e1' });
  });

  it('edge.delete → edge.create с полным снимком связи', () => {
    const existing = edge();
    const op: BoardOp = { type: 'edge.delete', clientOpId: 'c1', id: 'e1' };

    const [inverse] = deriveInverseOps([op], state([], [existing]));

    expect(inverse).toMatchObject({ type: 'edge.create', edge: existing });
  });

  it('edge.patch → инверс-патч только по тронутым полям, включая вложенный style', () => {
    const existing = edge({
      label: 'было',
      style: { line: 'straight', dash: 'solid', markerStart: 'none', markerEnd: 'arrow' },
    });
    const op: BoardOp = {
      type: 'edge.patch',
      clientOpId: 'c1',
      id: 'e1',
      patch: { label: 'стало', style: { line: 'curved' } },
    };

    const [inverse] = deriveInverseOps([op], state([], [existing]));

    expect(inverse).toMatchObject({
      type: 'edge.patch',
      id: 'e1',
      patch: { label: 'было', style: { line: 'straight' } },
    });
  });
});

describe('regenerateClientOpIds', () => {
  it('меняет clientOpId на новый у каждой операции, остальное сохраняет', () => {
    const ops: BoardOp[] = [{ type: 'item.delete', clientOpId: 'old', id: 'i1' }];

    const [regenerated] = regenerateClientOpIds(ops);

    expect(regenerated!.clientOpId).not.toBe('old');
    expect(regenerated).toMatchObject({ type: 'item.delete', id: 'i1' });
  });
});

describe('filterExistingTargets', () => {
  it('item.create проходит всегда', () => {
    const op: BoardOp = { type: 'item.create', clientOpId: 'c1', item: item() };

    expect(filterExistingTargets([op], state())).toEqual([op]);
  });

  it('item.patch/item.delete отбрасываются, если цель уже удалена', () => {
    const ops: BoardOp[] = [
      { type: 'item.patch', clientOpId: 'c1', id: 'gone', patch: { x: 1 } },
      { type: 'item.delete', clientOpId: 'c2', id: 'gone' },
    ];

    expect(filterExistingTargets(ops, state())).toEqual([]);
  });

  it('edge.create отбрасывается, если хотя бы один конец уже удалён', () => {
    const op: BoardOp = { type: 'edge.create', clientOpId: 'c1', edge: edge() };

    expect(filterExistingTargets([op], state([item({ id: 'i1' })]))).toEqual([]);
    expect(filterExistingTargets([op], state([item({ id: 'i1' }), item({ id: 'i2' })]))).toEqual([
      op,
    ]);
  });

  it('edge.patch/edge.delete отбрасываются, если связь уже удалена', () => {
    const ops: BoardOp[] = [
      { type: 'edge.patch', clientOpId: 'c1', id: 'gone', patch: { label: 'x' } },
      { type: 'edge.delete', clientOpId: 'c2', id: 'gone' },
    ];

    expect(filterExistingTargets(ops, state())).toEqual([]);
  });
});

describe('deriveInverseOps — фреймы и группы (14.3)', () => {
  it('удаление контейнера восстанавливает parentId детей в inverse', () => {
    const frameId = 'frame';
    const childId = 'child';
    const frame = item({ id: frameId, content: { type: 'frame', title: 'Группа' } });
    const child = item({ id: childId, parentId: frameId });
    const op: BoardOp = { type: 'item.delete', clientOpId: 'c1', id: frameId };

    const inverses = deriveInverseOps([op], state([frame, child]));

    // item.create для фрейма + item.patch для ребёнка с parentId → frameId
    expect(inverses).toContainEqual(expect.objectContaining({ type: 'item.create', item: frame }));
    expect(inverses).toContainEqual(
      expect.objectContaining({ type: 'item.patch', id: childId, patch: { parentId: frameId } }),
    );
  });

  it('удаление группы тоже осирает и восстанавливает детей', () => {
    const groupId = 'group';
    const childId = 'child';
    const group = item({ id: groupId, content: { type: 'group' } });
    const child = item({ id: childId, parentId: groupId });
    const op: BoardOp = { type: 'item.delete', clientOpId: 'c1', id: groupId };

    const inverses = deriveInverseOps([op], state([group, child]));

    expect(inverses).toContainEqual(
      expect.objectContaining({ type: 'item.patch', id: childId, patch: { parentId: groupId } }),
    );
  });

  it('удаление контейнера + ребёнка ОДНИМ батчем: item.create контейнера идёт раньше item.create ребёнка в inverse, независимо от порядка ops', () => {
    // Регрессия: filterExistingTargets на undo вырезает связывающий item.patch
    // (ребёнок уже не существует в local на момент undo), оставляя два "голых"
    // item.create — если create ребёнка (с уже зашитым parentId) окажется ПЕРЕД
    // create контейнера, сервер отклонит весь undo-батч ("Родитель не найден")
    const frameId = 'frame';
    const childId = 'child';
    const frame = item({ id: frameId, content: { type: 'frame', title: '' } });
    const child = item({ id: childId, parentId: frameId });

    // Порядок ops намеренно "ребёнок раньше контейнера" — именно тот случай,
    // где родитель ещё не восстановлен к моменту наивной сборки инверсии
    const opsChildFirst: BoardOp[] = [
      { type: 'item.delete', clientOpId: 'c1', id: childId },
      { type: 'item.delete', clientOpId: 'c2', id: frameId },
    ];
    const inversesChildFirst = deriveInverseOps(opsChildFirst, state([frame, child]));
    const filteredChildFirst = filterExistingTargets(inversesChildFirst, state());
    const createIndexesChildFirst = filteredChildFirst
      .map((op, index) => (op.type === 'item.create' ? { index, id: op.item.id } : null))
      .filter((entry): entry is { index: number; id: string } => entry !== null);
    const frameIndexChildFirst = createIndexesChildFirst.find((e) => e.id === frameId)!.index;
    const childIndexChildFirst = createIndexesChildFirst.find((e) => e.id === childId)!.index;
    expect(frameIndexChildFirst).toBeLessThan(childIndexChildFirst);

    // И обратный порядок — контейнер раньше ребёнка в исходных ops — тоже должен остаться корректным
    const opsContainerFirst: BoardOp[] = [
      { type: 'item.delete', clientOpId: 'c1', id: frameId },
      { type: 'item.delete', clientOpId: 'c2', id: childId },
    ];
    const inversesContainerFirst = deriveInverseOps(opsContainerFirst, state([frame, child]));
    const filteredContainerFirst = filterExistingTargets(inversesContainerFirst, state());
    const createIndexesContainerFirst = filteredContainerFirst
      .map((op, index) => (op.type === 'item.create' ? { index, id: op.item.id } : null))
      .filter((entry): entry is { index: number; id: string } => entry !== null);
    const frameIndexContainerFirst = createIndexesContainerFirst.find(
      (e) => e.id === frameId,
    )!.index;
    const childIndexContainerFirst = createIndexesContainerFirst.find(
      (e) => e.id === childId,
    )!.index;
    expect(frameIndexContainerFirst).toBeLessThan(childIndexContainerFirst);
  });

  it('item.patch parentId → null: inverse восстанавливает старый parentId', () => {
    const frameId = 'frame';
    const childId = 'child';
    const frame = item({ id: frameId, content: { type: 'frame', title: '' } });
    const child = item({ id: childId, parentId: frameId });
    const op: BoardOp = {
      type: 'item.patch',
      clientOpId: 'c1',
      id: childId,
      patch: { parentId: null },
    };

    const inverses = deriveInverseOps([op], state([frame, child]));

    expect(inverses).toHaveLength(1);
    expect(inverses[0]).toMatchObject({
      type: 'item.patch',
      id: childId,
      patch: { parentId: frameId },
    });
  });
});
