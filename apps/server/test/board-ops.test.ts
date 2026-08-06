/**
 * Юнит-тесты применения операций доски (12.4): чистая логика без БД и сокетов.
 */
import { randomUUID } from 'node:crypto';

import type { BoardEdge, BoardItem, BoardOp } from '@poker/shared';
import { describe, expect, it } from 'vitest';

import { applyBoardOp, type BoardOpState } from '../src/boards/board-ops';
import { ValidationError } from '../src/errors';

const BOARD_ID = 'board-1';
const ACTOR_ID = 'user-1';

function emptyState(): BoardOpState {
  return { items: new Map(), edges: new Map() };
}

function stickyCreateOp(id: string): BoardOp {
  return {
    type: 'item.create',
    clientOpId: randomUUID(),
    item: {
      id,
      parentId: null,
      x: 10,
      y: 20,
      width: 160,
      height: 120,
      rotation: 0,
      zIndex: 0,
      content: { type: 'sticky', text: 'Привет' },
      style: { color: 'yellow' },
    },
  };
}

describe('applyBoardOp — item.create', () => {
  it('создаёт стикер в пустом состоянии', () => {
    const state = emptyState();
    const id = randomUUID();

    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID);

    const item = state.items.get(id);
    expect(item).toMatchObject({ id, boardId: BOARD_ID, createdBy: ACTOR_ID, x: 10, y: 20 });
  });

  it('отклоняет создание элемента с уже занятым id', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID);

    expect(() => applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID)).toThrow(
      ValidationError,
    );
  });

  it('отклоняет некорректный id (не UUID)', () => {
    const state = emptyState();

    expect(() => applyBoardOp(state, stickyCreateOp('not-a-uuid'), BOARD_ID, ACTOR_ID)).toThrow(
      ValidationError,
    );
  });

  it('отклоняет недопустимый цвет', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { style: unknown } }).item.style = { color: 'rainbow' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID)).toThrow(ValidationError);
  });

  it('отклоняет слишком длинный текст стикера', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: 'x'.repeat(3000),
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID)).toThrow(ValidationError);
  });

  it('отклоняет неположительные width/height', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { width: number } }).item.width = 0;

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID)).toThrow(ValidationError);
  });

  it('отклоняет parentId — группировка ещё не поддерживается (14.3)', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { parentId: unknown } }).item.parentId = randomUUID();

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID)).toThrow(ValidationError);
  });

  it('отклоняет фигуру с недопустимой формой', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'shape',
      shape: 'triangle',
      text: '',
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID)).toThrow(ValidationError);
  });

  it('отклоняет создание сверх лимита элементов на доске', () => {
    const state = emptyState();
    for (let i = 0; i < 2000; i++) {
      const id = randomUUID();
      state.items.set(id, {
        id,
        boardId: BOARD_ID,
        parentId: null,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rotation: 0,
        zIndex: 0,
        content: { type: 'sticky', text: '' },
        style: { color: 'yellow' },
        createdBy: ACTOR_ID,
        updatedAt: new Date().toISOString(),
      } satisfies BoardItem);
    }

    expect(() => applyBoardOp(state, stickyCreateOp(randomUUID()), BOARD_ID, ACTOR_ID)).toThrow(
      ValidationError,
    );
  });
});

describe('applyBoardOp — item.patch', () => {
  it('обновляет геометрию, не трогая остальные поля', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID);

    applyBoardOp(
      state,
      { type: 'item.patch', clientOpId: randomUUID(), id, patch: { x: 500, y: 500 } },
      BOARD_ID,
      ACTOR_ID,
    );

    const item = state.items.get(id)!;
    expect(item.x).toBe(500);
    expect(item.y).toBe(500);
    expect(item.content).toEqual({ type: 'sticky', text: 'Привет' });
  });

  it('обновляет текст содержимого', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID);

    applyBoardOp(
      state,
      {
        type: 'item.patch',
        clientOpId: randomUUID(),
        id,
        patch: { content: { type: 'sticky', text: 'Новый текст' } },
      },
      BOARD_ID,
      ACTOR_ID,
    );

    expect(state.items.get(id)!.content).toEqual({ type: 'sticky', text: 'Новый текст' });
  });

  it('отклоняет патч несуществующего элемента', () => {
    const state = emptyState();

    expect(() =>
      applyBoardOp(
        state,
        { type: 'item.patch', clientOpId: randomUUID(), id: randomUUID(), patch: { x: 1 } },
        BOARD_ID,
        ACTOR_ID,
      ),
    ).toThrow(ValidationError);
  });
});

describe('applyBoardOp — item.delete', () => {
  it('удаляет элемент и связанные с ним связи в том же батче', () => {
    const state = emptyState();
    const a = randomUUID();
    const b = randomUUID();
    applyBoardOp(state, stickyCreateOp(a), BOARD_ID, ACTOR_ID);
    applyBoardOp(state, stickyCreateOp(b), BOARD_ID, ACTOR_ID);
    const edgeId = randomUUID();
    applyBoardOp(
      state,
      {
        type: 'edge.create',
        clientOpId: randomUUID(),
        edge: {
          id: edgeId,
          sourceItemId: a,
          targetItemId: b,
          sourceHandle: null,
          targetHandle: null,
          label: null,
          style: { color: 'blue', line: 'straight' },
        },
      },
      BOARD_ID,
      ACTOR_ID,
    );

    applyBoardOp(
      state,
      { type: 'item.delete', clientOpId: randomUUID(), id: a },
      BOARD_ID,
      ACTOR_ID,
    );

    expect(state.items.has(a)).toBe(false);
    expect(state.edges.has(edgeId)).toBe(false);
  });

  it('отклоняет удаление несуществующего элемента', () => {
    const state = emptyState();

    expect(() =>
      applyBoardOp(
        state,
        { type: 'item.delete', clientOpId: randomUUID(), id: randomUUID() },
        BOARD_ID,
        ACTOR_ID,
      ),
    ).toThrow(ValidationError);
  });
});

describe('applyBoardOp — edge.create/patch/delete', () => {
  function withTwoItems(): { state: BoardOpState; a: string; b: string } {
    const state = emptyState();
    const a = randomUUID();
    const b = randomUUID();
    applyBoardOp(state, stickyCreateOp(a), BOARD_ID, ACTOR_ID);
    applyBoardOp(state, stickyCreateOp(b), BOARD_ID, ACTOR_ID);
    return { state, a, b };
  }

  function edgeCreateOp(id: string, a: string, b: string): BoardOp {
    return {
      type: 'edge.create',
      clientOpId: randomUUID(),
      edge: {
        id,
        sourceItemId: a,
        targetItemId: b,
        sourceHandle: null,
        targetHandle: null,
        label: null,
        style: { color: 'blue', line: 'straight' },
      },
    };
  }

  it('создаёт связь между двумя существующими элементами', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();

    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR_ID);

    expect(state.edges.get(edgeId)).toMatchObject({ sourceItemId: a, targetItemId: b });
  });

  it('отклоняет связь на несуществующий элемент', () => {
    const { state, a } = withTwoItems();

    expect(() =>
      applyBoardOp(state, edgeCreateOp(randomUUID(), a, randomUUID()), BOARD_ID, ACTOR_ID),
    ).toThrow(ValidationError);
  });

  it('отклоняет связь элемента с самим собой', () => {
    const { state, a } = withTwoItems();

    expect(() => applyBoardOp(state, edgeCreateOp(randomUUID(), a, a), BOARD_ID, ACTOR_ID)).toThrow(
      ValidationError,
    );
  });

  it('отклоняет недопустимый тип линии', () => {
    const { state, a, b } = withTwoItems();
    const op = edgeCreateOp(randomUUID(), a, b);
    (op as { edge: { style: unknown } }).edge.style = { color: 'blue', line: 'zigzag' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID)).toThrow(ValidationError);
  });

  it('патчит подпись связи', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR_ID);

    applyBoardOp(
      state,
      { type: 'edge.patch', clientOpId: randomUUID(), id: edgeId, patch: { label: 'зависит от' } },
      BOARD_ID,
      ACTOR_ID,
    );

    expect((state.edges.get(edgeId) as BoardEdge).label).toBe('зависит от');
  });

  it('удаляет связь', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR_ID);

    applyBoardOp(
      state,
      { type: 'edge.delete', clientOpId: randomUUID(), id: edgeId },
      BOARD_ID,
      ACTOR_ID,
    );

    expect(state.edges.has(edgeId)).toBe(false);
  });

  it('отклоняет удаление несуществующей связи', () => {
    const { state } = withTwoItems();

    expect(() =>
      applyBoardOp(
        state,
        { type: 'edge.delete', clientOpId: randomUUID(), id: randomUUID() },
        BOARD_ID,
        ACTOR_ID,
      ),
    ).toThrow(ValidationError);
  });
});

describe('applyBoardOp — батч операций подряд', () => {
  it('операции в одном батче видят изменения друг друга', () => {
    const state = emptyState();
    const id = randomUUID();

    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID);
    applyBoardOp(
      state,
      { type: 'item.patch', clientOpId: randomUUID(), id, patch: { x: 42 } },
      BOARD_ID,
      ACTOR_ID,
    );
    applyBoardOp(state, { type: 'item.delete', clientOpId: randomUUID(), id }, BOARD_ID, ACTOR_ID);

    expect(state.items.has(id)).toBe(false);
  });
});
