/**
 * Юнит-тесты применения операций доски (12.4): чистая логика без БД и сокетов.
 */
import { randomUUID } from 'node:crypto';

import {
  BOARD_EDGE_LABEL_MAX_LENGTH,
  type BoardEdge,
  type BoardItem,
  type BoardOp,
} from '@poker/shared';
import { describe, expect, it } from 'vitest';

import { applyBoardOp, type BoardOpState } from '../src/boards/board-ops';
import { ValidationError } from '../src/errors';

const BOARD_ID = 'board-1';
const ACTOR_ID = 'user-1';
const ACTOR_NAME = 'Автор';

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
      style: { color: '#FCEB96' },
      reactions: [],
    },
  };
}

describe('applyBoardOp — item.create', () => {
  it('создаёт стикер в пустом состоянии', () => {
    const state = emptyState();
    const id = randomUUID();

    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID, ACTOR_NAME);

    const item = state.items.get(id);
    expect(item).toMatchObject({ id, boardId: BOARD_ID, createdBy: ACTOR_ID, x: 10, y: 20 });
  });

  it('отклоняет создание элемента с уже занятым id', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID, ACTOR_NAME);

    expect(() => applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(
      ValidationError,
    );
  });

  it('отклоняет некорректный id (не UUID)', () => {
    const state = emptyState();

    expect(() =>
      applyBoardOp(state, stickyCreateOp('not-a-uuid'), BOARD_ID, ACTOR_ID, ACTOR_NAME),
    ).toThrow(ValidationError);
  });

  it('отклоняет недопустимый цвет', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { style: unknown } }).item.style = { color: 'rainbow' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
  });

  it('отклоняет слишком длинный текст стикера', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: 'x'.repeat(3000),
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
  });

  it('отклоняет неположительные width/height', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { width: number } }).item.width = 0;

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
  });

  it('отклоняет parentId — группировка ещё не поддерживается (14.3)', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { parentId: unknown } }).item.parentId = randomUUID();

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
  });

  it('отклоняет фигуру с недопустимой формой', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'shape',
      shape: 'triangle',
      text: '',
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
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
        style: { color: '#FCEB96' },
        reactions: [],
        createdBy: ACTOR_ID,
        updatedAt: new Date().toISOString(),
      } satisfies BoardItem);
    }

    expect(() =>
      applyBoardOp(state, stickyCreateOp(randomUUID()), BOARD_ID, ACTOR_ID, ACTOR_NAME),
    ).toThrow(ValidationError);
  });
});

describe('applyBoardOp — item.patch', () => {
  it('обновляет геометрию, не трогая остальные поля', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID, ACTOR_NAME);

    applyBoardOp(
      state,
      { type: 'item.patch', clientOpId: randomUUID(), id, patch: { x: 500, y: 500 } },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    const item = state.items.get(id)!;
    expect(item.x).toBe(500);
    expect(item.y).toBe(500);
    expect(item.content).toEqual({ type: 'sticky', text: 'Привет' });
  });

  it('обновляет текст содержимого', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID, ACTOR_NAME);

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
      ACTOR_NAME,
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
        ACTOR_NAME,
      ),
    ).toThrow(ValidationError);
  });

  it('мержит style по полям, не заменяя целиком (12.9)', () => {
    const state = emptyState();
    const id = randomUUID();
    const op = stickyCreateOp(id);
    (op as { item: { style: unknown } }).item.style = { color: '#FCEB96', fontSize: 24 };
    applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME);

    // Патчим только color — fontSize из предыдущего style должен уцелеть
    applyBoardOp(
      state,
      {
        type: 'item.patch',
        clientOpId: randomUUID(),
        id,
        patch: { style: { color: '#A8CAFF' } },
      },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    expect(state.items.get(id)!.style).toEqual({ color: '#A8CAFF', fontSize: 24 });
  });

  it('принимает fontSize/fontFamily/textColor/textAlign в допустимых границах', () => {
    const state = emptyState();
    const id = randomUUID();
    const op = stickyCreateOp(id);
    (op as { item: { style: unknown } }).item.style = {
      color: '#FCEB96',
      fontSize: 32,
      fontFamily: 'heading',
      textColor: '#1A1A1A',
      textAlign: 'left',
    };
    applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME);

    expect(state.items.get(id)!.style).toEqual({
      color: '#FCEB96',
      fontSize: 32,
      fontFamily: 'heading',
      textColor: '#1A1A1A',
      textAlign: 'left',
    });
  });

  it('отклоняет размер шрифта вне границ', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { style: unknown } }).item.style = { color: '#FCEB96', fontSize: 999 };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
  });

  it('отклоняет недопустимый шрифт', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { style: unknown } }).item.style = { color: '#FCEB96', fontFamily: 'comic' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
  });

  it('отклоняет недопустимое выравнивание текста', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { style: unknown } }).item.style = { color: '#FCEB96', textAlign: 'justify' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
  });

  it('отклоняет недопустимый цвет текста', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { style: unknown } }).item.style = { color: '#FCEB96', textColor: 'red' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
  });
});

describe('applyBoardOp — item.delete', () => {
  it('удаляет элемент и связанные с ним связи в том же батче', () => {
    const state = emptyState();
    const a = randomUUID();
    const b = randomUUID();
    applyBoardOp(state, stickyCreateOp(a), BOARD_ID, ACTOR_ID, ACTOR_NAME);
    applyBoardOp(state, stickyCreateOp(b), BOARD_ID, ACTOR_ID, ACTOR_NAME);
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
          style: { color: '#A8CAFF', line: 'straight', markerStart: 'none', markerEnd: 'none' },
        },
      },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    applyBoardOp(
      state,
      { type: 'item.delete', clientOpId: randomUUID(), id: a },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
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
        ACTOR_NAME,
      ),
    ).toThrow(ValidationError);
  });
});

describe('applyBoardOp — item.react', () => {
  const OTHER_ACTOR_ID = 'user-2';
  const OTHER_ACTOR_NAME = 'Второй автор';

  it('добавляет реакцию на стикер', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID, ACTOR_NAME);

    applyBoardOp(
      state,
      { type: 'item.react', clientOpId: randomUUID(), id, emoji: '👍' },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    expect(state.items.get(id)!.reactions).toEqual([
      { userId: ACTOR_ID, name: ACTOR_NAME, emoji: '👍' },
    ]);
  });

  it('повторная присылка того же эмодзи снимает реакцию (toggle)', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID, ACTOR_NAME);
    applyBoardOp(
      state,
      { type: 'item.react', clientOpId: randomUUID(), id, emoji: '👍' },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    applyBoardOp(
      state,
      { type: 'item.react', clientOpId: randomUUID(), id, emoji: '👍' },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    expect(state.items.get(id)!.reactions).toEqual([]);
  });

  it('разные пользователи реагируют независимо на один и тот же стикер', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID, ACTOR_NAME);
    applyBoardOp(
      state,
      { type: 'item.react', clientOpId: randomUUID(), id, emoji: '👍' },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    applyBoardOp(
      state,
      { type: 'item.react', clientOpId: randomUUID(), id, emoji: '🔥' },
      BOARD_ID,
      OTHER_ACTOR_ID,
      OTHER_ACTOR_NAME,
    );

    expect(state.items.get(id)!.reactions).toEqual(
      expect.arrayContaining([
        { userId: ACTOR_ID, name: ACTOR_NAME, emoji: '👍' },
        { userId: OTHER_ACTOR_ID, name: OTHER_ACTOR_NAME, emoji: '🔥' },
      ]),
    );
  });

  it('отклоняет реакцию на несуществующий элемент', () => {
    const state = emptyState();

    expect(() =>
      applyBoardOp(
        state,
        { type: 'item.react', clientOpId: randomUUID(), id: randomUUID(), emoji: '👍' },
        BOARD_ID,
        ACTOR_ID,
        ACTOR_NAME,
      ),
    ).toThrow(ValidationError);
  });

  it('отклоняет реакцию на фигуру — только стикеры (12.12)', () => {
    const state = emptyState();
    const id = randomUUID();
    const op = stickyCreateOp(id);
    (op as { item: { content: unknown } }).item.content = {
      type: 'shape',
      shape: 'rectangle',
      text: '',
    };
    applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME);

    expect(() =>
      applyBoardOp(
        state,
        { type: 'item.react', clientOpId: randomUUID(), id, emoji: '👍' },
        BOARD_ID,
        ACTOR_ID,
        ACTOR_NAME,
      ),
    ).toThrow(ValidationError);
  });

  it('отклоняет недопустимый эмодзи', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID, ACTOR_NAME);

    expect(() =>
      applyBoardOp(
        state,
        { type: 'item.react', clientOpId: randomUUID(), id, emoji: '🤡' as never },
        BOARD_ID,
        ACTOR_ID,
        ACTOR_NAME,
      ),
    ).toThrow(ValidationError);
  });
});

describe('applyBoardOp — edge.create/patch/delete', () => {
  function withTwoItems(): { state: BoardOpState; a: string; b: string } {
    const state = emptyState();
    const a = randomUUID();
    const b = randomUUID();
    applyBoardOp(state, stickyCreateOp(a), BOARD_ID, ACTOR_ID, ACTOR_NAME);
    applyBoardOp(state, stickyCreateOp(b), BOARD_ID, ACTOR_ID, ACTOR_NAME);
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
        style: { color: '#A8CAFF', line: 'straight', markerStart: 'none', markerEnd: 'none' },
      },
    };
  }

  it('создаёт связь между двумя существующими элементами', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();

    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR_ID, ACTOR_NAME);

    expect(state.edges.get(edgeId)).toMatchObject({ sourceItemId: a, targetItemId: b });
  });

  it('отклоняет связь на несуществующий элемент', () => {
    const { state, a } = withTwoItems();

    expect(() =>
      applyBoardOp(
        state,
        edgeCreateOp(randomUUID(), a, randomUUID()),
        BOARD_ID,
        ACTOR_ID,
        ACTOR_NAME,
      ),
    ).toThrow(ValidationError);
  });

  it('отклоняет связь элемента с самим собой', () => {
    const { state, a } = withTwoItems();

    expect(() =>
      applyBoardOp(state, edgeCreateOp(randomUUID(), a, a), BOARD_ID, ACTOR_ID, ACTOR_NAME),
    ).toThrow(ValidationError);
  });

  it('отклоняет недопустимый тип линии', () => {
    const { state, a, b } = withTwoItems();
    const op = edgeCreateOp(randomUUID(), a, b);
    (op as { edge: { style: unknown } }).edge.style = {
      color: '#A8CAFF',
      line: 'zigzag',
      markerStart: 'none',
      markerEnd: 'none',
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
  });

  it('принимает ломаную линию', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR_ID, ACTOR_NAME);

    applyBoardOp(
      state,
      {
        type: 'edge.patch',
        clientOpId: randomUUID(),
        id: edgeId,
        patch: { style: { line: 'orthogonal' } },
      },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    expect((state.edges.get(edgeId) as BoardEdge).style.line).toBe('orthogonal');
  });

  it('создаёт связь без явного цвета (12.9) — резолвится на фронте от темы зрителя', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    const op = edgeCreateOp(edgeId, a, b);
    (op as { edge: { style: { color?: unknown } } }).edge.style.color = undefined;

    applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME);

    expect(state.edges.get(edgeId)!.style.color).toBeUndefined();
  });

  it('отклоняет недопустимый маркер', () => {
    const { state, a, b } = withTwoItems();
    const op = edgeCreateOp(randomUUID(), a, b);
    (op as { edge: { style: unknown } }).edge.style = {
      color: '#A8CAFF',
      line: 'straight',
      markerStart: 'star',
      markerEnd: 'none',
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR_ID, ACTOR_NAME)).toThrow(ValidationError);
  });

  it('патчит маркеры', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR_ID, ACTOR_NAME);

    applyBoardOp(
      state,
      {
        type: 'edge.patch',
        clientOpId: randomUUID(),
        id: edgeId,
        patch: { style: { markerStart: 'arrow', markerEnd: 'dot' } },
      },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    expect((state.edges.get(edgeId) as BoardEdge).style.markerStart).toBe('arrow');
    expect((state.edges.get(edgeId) as BoardEdge).style.markerEnd).toBe('dot');
  });

  it('патчит подпись связи', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR_ID, ACTOR_NAME);

    applyBoardOp(
      state,
      { type: 'edge.patch', clientOpId: randomUUID(), id: edgeId, patch: { label: 'зависит от' } },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    expect((state.edges.get(edgeId) as BoardEdge).label).toBe('зависит от');
  });

  it('отклоняет слишком длинную подпись связи', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR_ID, ACTOR_NAME);
    const tooLong = 'x'.repeat(BOARD_EDGE_LABEL_MAX_LENGTH + 1);

    expect(() =>
      applyBoardOp(
        state,
        { type: 'edge.patch', clientOpId: randomUUID(), id: edgeId, patch: { label: tooLong } },
        BOARD_ID,
        ACTOR_ID,
        ACTOR_NAME,
      ),
    ).toThrow(ValidationError);
  });

  it('удаляет связь', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR_ID, ACTOR_NAME);

    applyBoardOp(
      state,
      { type: 'edge.delete', clientOpId: randomUUID(), id: edgeId },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
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
        ACTOR_NAME,
      ),
    ).toThrow(ValidationError);
  });
});

describe('applyBoardOp — батч операций подряд', () => {
  it('операции в одном батче видят изменения друг друга', () => {
    const state = emptyState();
    const id = randomUUID();

    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR_ID, ACTOR_NAME);
    applyBoardOp(
      state,
      { type: 'item.patch', clientOpId: randomUUID(), id, patch: { x: 42 } },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );
    applyBoardOp(
      state,
      { type: 'item.delete', clientOpId: randomUUID(), id },
      BOARD_ID,
      ACTOR_ID,
      ACTOR_NAME,
    );

    expect(state.items.has(id)).toBe(false);
  });
});
