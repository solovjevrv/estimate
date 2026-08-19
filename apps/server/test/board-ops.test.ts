/**
 * Юнит-тесты применения операций доски (12.4): чистая логика без БД и сокетов.
 */
import { randomUUID } from 'node:crypto';

import {
  BOARD_EDGE_LABEL_MAX_LENGTH,
  BOARD_EDGE_CURVE_OFFSET_MAX,
  BOARD_EDGE_LABEL_OFFSET_MAX,
  REACTION_EMOJIS,
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
const ACTOR = { participantId: ACTOR_ID, userId: ACTOR_ID, name: ACTOR_NAME };

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

function textCreateOp(id: string): BoardOp {
  return {
    type: 'item.create',
    clientOpId: randomUUID(),
    item: {
      id,
      parentId: null,
      x: 10,
      y: 20,
      width: 200,
      height: 40,
      rotation: 0,
      zIndex: 0,
      content: { type: 'text', text: 'Текст' },
      style: { color: '#FCEB96', textColor: '#1A1A1A' },
      reactions: [],
    },
  };
}

function imageCreateOp(
  id: string,
  url = `/api/boards/${BOARD_ID}/assets/${'a'.repeat(32)}.webp`,
): BoardOp {
  return {
    type: 'item.create',
    clientOpId: randomUUID(),
    item: {
      id,
      parentId: null,
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      rotation: 0,
      zIndex: 0,
      content: { type: 'image', url, width: 1200, height: 800 },
      style: { color: '#FCEB96' },
      reactions: [],
    },
  };
}

function emojiCreateOp(id: string, emoji: string = REACTION_EMOJIS[0]): BoardOp {
  return {
    type: 'item.create',
    clientOpId: randomUUID(),
    item: {
      id,
      parentId: null,
      x: 10,
      y: 20,
      width: 120,
      height: 120,
      rotation: 0,
      zIndex: 0,
      content: { type: 'emoji', emoji } as BoardItem['content'],
      style: { color: '#FCEB96' },
      reactions: [],
    },
  };
}

function stickerCreateOp(
  id: string,
  pack: string = 'eduardkonstantinovich',
  itemId: string = '01',
): BoardOp {
  return {
    type: 'item.create',
    clientOpId: randomUUID(),
    item: {
      id,
      parentId: null,
      x: 10,
      y: 20,
      width: 120,
      height: 120,
      rotation: 0,
      zIndex: 0,
      content: { type: 'sticker', pack, id: itemId } as BoardItem['content'],
      style: { color: '#FCEB96' },
      reactions: [],
    },
  };
}

/** Фрейм (14.3) — видимый контейнер с заголовком, parentId обязан быть null */
function frameCreateOp(id: string, title = ''): BoardOp {
  return {
    type: 'item.create',
    clientOpId: randomUUID(),
    item: {
      id,
      parentId: null,
      x: 10,
      y: 20,
      width: 640,
      height: 400,
      rotation: 0,
      zIndex: 0,
      content: { type: 'frame', title },
      style: { color: '#FCEB96' },
      reactions: [],
    },
  };
}

/** Группа (14.3) — невидимый контейнер, parentId обязан быть null */
function groupCreateOp(id: string): BoardOp {
  return {
    type: 'item.create',
    clientOpId: randomUUID(),
    item: {
      id,
      parentId: null,
      x: 10,
      y: 20,
      width: 320,
      height: 240,
      rotation: 0,
      zIndex: 0,
      content: { type: 'group' },
      style: { color: '#FCEB96' },
      reactions: [],
    },
  };
}

function childItemOp(id: string, parentId: string): BoardOp {
  const op = stickyCreateOp(id);
  (op as { item: { parentId: string } }).item.parentId = parentId;
  return op;
}

describe('applyBoardOp — item.create', () => {
  it('создаёт стикер в пустом состоянии', () => {
    const state = emptyState();
    const id = randomUUID();

    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);

    const item = state.items.get(id);
    expect(item).toMatchObject({ id, boardId: BOARD_ID, createdBy: ACTOR_ID, x: 10, y: 20 });
  });

  it('создаёт текстовый элемент в пустом состоянии', () => {
    const state = emptyState();
    const id = randomUUID();

    applyBoardOp(state, textCreateOp(id), BOARD_ID, ACTOR);

    const item = state.items.get(id);
    expect(item).toMatchObject({ id, boardId: BOARD_ID, createdBy: ACTOR_ID, x: 10, y: 20 });
    expect(item?.content.type).toBe('text');
    if (item?.content.type === 'text') {
      expect(item.content.text).toBe('Текст');
    }
  });

  it('создаёт элемент-картинку в пустом состоянии', () => {
    const state = emptyState();
    const id = randomUUID();

    applyBoardOp(state, imageCreateOp(id), BOARD_ID, ACTOR);

    const item = state.items.get(id);
    expect(item?.content.type).toBe('image');
    if (item?.content.type === 'image') {
      expect(item.content.url).toBe(`/api/boards/${BOARD_ID}/assets/${'a'.repeat(32)}.webp`);
      expect(item.content.width).toBe(1200);
      expect(item.content.height).toBe(800);
    }
  });

  it('отклоняет url картинки другой доски (защита от подмены между досками)', () => {
    const state = emptyState();
    const op = imageCreateOp(randomUUID(), `/api/boards/чужая-доска/assets/${'a'.repeat(32)}.webp`);

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет произвольный url вне /api/boards/.../assets/... (защита от SSRF/XSS)', () => {
    const state = emptyState();
    const op = imageCreateOp(randomUUID(), 'https://evil.example.com/x.png');

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет url с именем файла не по формату (не 32 hex + .webp)', () => {
    const state = emptyState();
    const op = imageCreateOp(randomUUID(), `/api/boards/${BOARD_ID}/assets/not-a-real-name.webp`);

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет картинку без width/height', () => {
    const state = emptyState();
    const op = imageCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'image',
      url: `/api/boards/${BOARD_ID}/assets/${'a'.repeat(32)}.webp`,
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('создаёт элемент-эмодзи в пустом состоянии', () => {
    const state = emptyState();
    const id = randomUUID();

    applyBoardOp(state, emojiCreateOp(id, REACTION_EMOJIS[3]), BOARD_ID, ACTOR);

    const item = state.items.get(id);
    expect(item?.content.type).toBe('emoji');
    if (item?.content.type === 'emoji') {
      expect(item.content.emoji).toBe(REACTION_EMOJIS[3]);
    }
  });

  it('отклоняет эмодзи вне фиксированного набора (13.3, произвольный unicode запрещён)', () => {
    const state = emptyState();
    const op = emojiCreateOp(randomUUID(), '🦄');

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('создаёт элемент-стикер в пустом состоянии', () => {
    const state = emptyState();
    const id = randomUUID();

    applyBoardOp(state, stickerCreateOp(id, 'eduardkonstantinovich', '01'), BOARD_ID, ACTOR);

    const item = state.items.get(id);
    expect(item?.content.type).toBe('sticker');
    if (item?.content.type === 'sticker') {
      expect(item.content.pack).toBe('eduardkonstantinovich');
      expect(item.content.id).toBe('01');
    }
  });

  it('отклоняет стикер с некорректным pack (пустой)', () => {
    const state = emptyState();
    const op = stickerCreateOp(randomUUID(), '', '01');

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет стикер с некорректным pack (спецсимволы)', () => {
    const state = emptyState();
    const op = stickerCreateOp(randomUUID(), 'Invalid_Pack!', '01');

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет стикер с некорректным id (пустой)', () => {
    const state = emptyState();
    const op = stickerCreateOp(randomUUID(), 'eduardkonstantinovich', '');

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет стикер с некорректным id (спецсимволы)', () => {
    const state = emptyState();
    const op = stickerCreateOp(randomUUID(), 'eduardkonstantinovich', 'Invalid_ID!');

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет стикер без поля pack', () => {
    const state = emptyState();
    const op = stickerCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = { type: 'sticker', id: '01' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет стикер без поля id', () => {
    const state = emptyState();
    const op = stickerCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticker',
      pack: 'eduardkonstantinovich',
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет эмодзи без самого поля emoji', () => {
    const state = emptyState();
    const op = emojiCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = { type: 'emoji' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет создание элемента с уже занятым id', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);

    expect(() => applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет некорректный id (не UUID)', () => {
    const state = emptyState();

    expect(() => applyBoardOp(state, stickyCreateOp('not-a-uuid'), BOARD_ID, ACTOR)).toThrow(
      ValidationError,
    );
  });

  it('отклоняет недопустимый цвет', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { style: unknown } }).item.style = { color: 'rainbow' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет слишком длинный текст стикера', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: 'x'.repeat(3000),
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет неположительные width/height', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { width: number } }).item.width = 0;

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет parentId, если указанный родитель не существует', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { parentId: unknown } }).item.parentId = randomUUID();

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет фигуру с недопустимой формой', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'shape',
      shape: 'triangle',
      text: '',
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('принимает текстовый элемент с форматированием (runs)', () => {
    const state = emptyState();
    const id = randomUUID();
    const op = textCreateOp(id);
    (op as { item: { content: unknown } }).item.content = {
      type: 'text',
      text: 'Привет мир',
      runs: [{ text: 'Привет ' }, { text: 'мир', marks: { bold: true, highlight: 'yellow' } }],
    };

    applyBoardOp(state, op, BOARD_ID, ACTOR);

    const item = state.items.get(id)!;
    expect(item.content).toEqual({
      type: 'text',
      text: 'Привет мир',
      runs: [{ text: 'Привет ' }, { text: 'мир', marks: { bold: true, highlight: 'yellow' } }],
    });
  });

  it('отклоняет текстовый элемент, чья конкатенация runs не совпадает с text', () => {
    const state = emptyState();
    const op = textCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'text',
      text: 'Привет мир',
      runs: [{ text: 'Другой текст' }],
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет текстовый элемент с недопустимым цветом маркера', () => {
    const state = emptyState();
    const op = textCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'text',
      text: 'мир',
      runs: [{ text: 'мир', marks: { highlight: 'purple' } }],
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
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

    expect(() => applyBoardOp(state, stickyCreateOp(randomUUID()), BOARD_ID, ACTOR)).toThrow(
      ValidationError,
    );
  });
});

describe('applyBoardOp — item.create — форматирование текста (runs, 12.13)', () => {
  it('принимает валидные runs и сохраняет их вместе с text', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: 'Привет мир',
      runs: [{ text: 'Привет ' }, { text: 'мир', marks: { bold: true, highlight: 'yellow' } }],
    };

    applyBoardOp(state, op, BOARD_ID, ACTOR);

    const item = state.items.get((op as { item: { id: string } }).item.id)!;
    expect(item.content).toEqual({
      type: 'sticky',
      text: 'Привет мир',
      runs: [{ text: 'Привет ' }, { text: 'мир', marks: { bold: true, highlight: 'yellow' } }],
    });
  });

  it('отклоняет runs, чья конкатенация не совпадает с text', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: 'Привет мир',
      runs: [{ text: 'Другой текст' }],
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет недопустимый цвет маркера', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: 'мир',
      runs: [{ text: 'мир', marks: { highlight: 'purple' } }],
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет ссылку без http(s)-схемы', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: 'мир',
      runs: [{ text: 'мир', marks: { link: 'javascript:alert(1)' } }],
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет слишком длинную ссылку', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: 'мир',
      runs: [{ text: 'мир', marks: { link: `https://example.com/${'x'.repeat(600)}` } }],
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет нестроковое/небулево значение в marks', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: 'мир',
      runs: [{ text: 'мир', marks: { bold: 'yes' } }],
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет runs сверх лимита (защита от раздутого payload)', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: 'a'.repeat(201),
      runs: Array.from({ length: 201 }, () => ({ text: 'a' })),
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет run с пустым text (обходил бы лимит числа runs полезной нагрузкой в marks)', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'sticky',
      text: '',
      runs: [{ text: '', marks: { link: 'https://example.com' } }],
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('без runs (undefined) работает как раньше — просто текст', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);

    expect(state.items.get(id)!.content).toEqual({ type: 'sticky', text: 'Привет' });
  });
});

describe('applyBoardOp — item.patch', () => {
  it('обновляет геометрию, не трогая остальные поля', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      { type: 'item.patch', clientOpId: randomUUID(), id, patch: { x: 500, y: 500 } },
      BOARD_ID,
      ACTOR,
    );

    const item = state.items.get(id)!;
    expect(item.x).toBe(500);
    expect(item.y).toBe(500);
    expect(item.content).toEqual({ type: 'sticky', text: 'Привет' });
  });

  it('обновляет текст содержимого', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'item.patch',
        clientOpId: randomUUID(),
        id,
        patch: { content: { type: 'sticky', text: 'Новый текст' } },
      },
      BOARD_ID,
      ACTOR,
    );

    expect(state.items.get(id)!.content).toEqual({ type: 'sticky', text: 'Новый текст' });
  });

  it('патчит форматирование (runs, 12.13) и отклоняет рассинхрон с text', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'item.patch',
        clientOpId: randomUUID(),
        id,
        patch: {
          content: {
            type: 'sticky',
            text: 'жирный',
            runs: [{ text: 'жирный', marks: { bold: true } }],
          },
        },
      },
      BOARD_ID,
      ACTOR,
    );
    expect(state.items.get(id)!.content).toEqual({
      type: 'sticky',
      text: 'жирный',
      runs: [{ text: 'жирный', marks: { bold: true } }],
    });

    expect(() =>
      applyBoardOp(
        state,
        {
          type: 'item.patch',
          clientOpId: randomUUID(),
          id,
          patch: {
            content: { type: 'sticky', text: 'жирный', runs: [{ text: 'другое' }] },
          },
        },
        BOARD_ID,
        ACTOR,
      ),
    ).toThrow(ValidationError);
  });

  it('отклоняет патч несуществующего элемента', () => {
    const state = emptyState();

    expect(() =>
      applyBoardOp(
        state,
        { type: 'item.patch', clientOpId: randomUUID(), id: randomUUID(), patch: { x: 1 } },
        BOARD_ID,
        ACTOR,
      ),
    ).toThrow(ValidationError);
  });

  it('мержит style по полям, не заменяя целиком (12.9)', () => {
    const state = emptyState();
    const id = randomUUID();
    const op = stickyCreateOp(id);
    (op as { item: { style: unknown } }).item.style = { color: '#FCEB96', fontSize: 24 };
    applyBoardOp(state, op, BOARD_ID, ACTOR);

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
      ACTOR,
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
    applyBoardOp(state, op, BOARD_ID, ACTOR);

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

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет недопустимый шрифт', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { style: unknown } }).item.style = { color: '#FCEB96', fontFamily: 'comic' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет недопустимое выравнивание текста', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { style: unknown } }).item.style = { color: '#FCEB96', textAlign: 'justify' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет недопустимый цвет текста', () => {
    const state = emptyState();
    const op = stickyCreateOp(randomUUID());
    (op as { item: { style: unknown } }).item.style = { color: '#FCEB96', textColor: 'red' };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });
});

describe('applyBoardOp — item.delete', () => {
  it('удаляет элемент и связанные с ним связи в том же батче', () => {
    const state = emptyState();
    const a = randomUUID();
    const b = randomUUID();
    applyBoardOp(state, stickyCreateOp(a), BOARD_ID, ACTOR);
    applyBoardOp(state, stickyCreateOp(b), BOARD_ID, ACTOR);
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
          style: {
            color: '#A8CAFF',
            line: 'straight',
            dash: 'solid',
            markerStart: 'none',
            markerEnd: 'none',
          },
        },
      },
      BOARD_ID,
      ACTOR,
    );

    applyBoardOp(state, { type: 'item.delete', clientOpId: randomUUID(), id: a }, BOARD_ID, ACTOR);

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
        ACTOR,
      ),
    ).toThrow(ValidationError);
  });
});

describe('applyBoardOp — item.react', () => {
  const OTHER_ACTOR_ID = 'user-2';
  const OTHER_ACTOR_NAME = 'Второй автор';
  const OTHER_ACTOR = {
    participantId: OTHER_ACTOR_ID,
    userId: OTHER_ACTOR_ID,
    name: OTHER_ACTOR_NAME,
  };

  it('добавляет реакцию на стикер', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      { type: 'item.react', clientOpId: randomUUID(), id, emoji: '👍' },
      BOARD_ID,
      ACTOR,
    );

    expect(state.items.get(id)!.reactions).toEqual([
      { userId: ACTOR_ID, name: ACTOR_NAME, emoji: '👍' },
    ]);
  });

  it('повторная присылка того же эмодзи снимает реакцию (toggle)', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);
    applyBoardOp(
      state,
      { type: 'item.react', clientOpId: randomUUID(), id, emoji: '👍' },
      BOARD_ID,
      ACTOR,
    );

    applyBoardOp(
      state,
      { type: 'item.react', clientOpId: randomUUID(), id, emoji: '👍' },
      BOARD_ID,
      ACTOR,
    );

    expect(state.items.get(id)!.reactions).toEqual([]);
  });

  it('разные пользователи реагируют независимо на один и тот же стикер', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);
    applyBoardOp(
      state,
      { type: 'item.react', clientOpId: randomUUID(), id, emoji: '👍' },
      BOARD_ID,
      ACTOR,
    );

    applyBoardOp(
      state,
      { type: 'item.react', clientOpId: randomUUID(), id, emoji: '🔥' },
      BOARD_ID,
      OTHER_ACTOR,
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
        ACTOR,
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
    applyBoardOp(state, op, BOARD_ID, ACTOR);

    expect(() =>
      applyBoardOp(
        state,
        { type: 'item.react', clientOpId: randomUUID(), id, emoji: '👍' },
        BOARD_ID,
        ACTOR,
      ),
    ).toThrow(ValidationError);
  });

  it('отклоняет недопустимый эмодзи', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);

    expect(() =>
      applyBoardOp(
        state,
        { type: 'item.react', clientOpId: randomUUID(), id, emoji: '🤡' as never },
        BOARD_ID,
        ACTOR,
      ),
    ).toThrow(ValidationError);
  });
});

describe('applyBoardOp — edge.create/patch/delete', () => {
  function withTwoItems(): { state: BoardOpState; a: string; b: string } {
    const state = emptyState();
    const a = randomUUID();
    const b = randomUUID();
    applyBoardOp(state, stickyCreateOp(a), BOARD_ID, ACTOR);
    applyBoardOp(state, stickyCreateOp(b), BOARD_ID, ACTOR);
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
        style: {
          color: '#A8CAFF',
          line: 'straight',
          dash: 'solid',
          markerStart: 'none',
          markerEnd: 'none',
        },
      },
    };
  }

  it('создаёт связь между двумя существующими элементами', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();

    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    expect(state.edges.get(edgeId)).toMatchObject({ sourceItemId: a, targetItemId: b });
  });

  it('отклоняет связь на несуществующий элемент', () => {
    const { state, a } = withTwoItems();

    expect(() =>
      applyBoardOp(state, edgeCreateOp(randomUUID(), a, randomUUID()), BOARD_ID, ACTOR),
    ).toThrow(ValidationError);
  });

  it('отклоняет связь элемента с самим собой', () => {
    const { state, a } = withTwoItems();

    expect(() => applyBoardOp(state, edgeCreateOp(randomUUID(), a, a), BOARD_ID, ACTOR)).toThrow(
      ValidationError,
    );
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

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('принимает ломаную линию', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'edge.patch',
        clientOpId: randomUUID(),
        id: edgeId,
        patch: { style: { line: 'orthogonal' } },
      },
      BOARD_ID,
      ACTOR,
    );

    expect((state.edges.get(edgeId) as BoardEdge).style.line).toBe('orthogonal');
  });

  it('отклоняет недопустимый стиль обводки связи', () => {
    const { state, a, b } = withTwoItems();
    const op = edgeCreateOp(randomUUID(), a, b);
    (op as { edge: { style: unknown } }).edge.style = {
      color: '#A8CAFF',
      line: 'straight',
      dash: 'zigzag',
      markerStart: 'none',
      markerEnd: 'none',
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('принимает штриховую обводку связи', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'edge.patch',
        clientOpId: randomUUID(),
        id: edgeId,
        patch: { style: { dash: 'dashed' } },
      },
      BOARD_ID,
      ACTOR,
    );

    expect((state.edges.get(edgeId) as BoardEdge).style.dash).toBe('dashed');
  });

  it('связь без явного dash в style получает дефолт solid', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    const op = edgeCreateOp(edgeId, a, b);
    // имитируем данные, созданные до появления фичи: ключ dash отсутствует вовсе
    (op as { edge: { style: unknown } }).edge.style = {
      color: '#A8CAFF',
      line: 'straight',
      markerStart: 'none',
      markerEnd: 'none',
    };

    applyBoardOp(state, op, BOARD_ID, ACTOR);

    expect((state.edges.get(edgeId) as BoardEdge).style.dash).toBe('solid');
  });

  it('создаёт связь без явного цвета (12.9) — резолвится на фронте от темы зрителя', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    const op = edgeCreateOp(edgeId, a, b);
    (op as { edge: { style: { color?: unknown } } }).edge.style.color = undefined;

    applyBoardOp(state, op, BOARD_ID, ACTOR);

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

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('патчит маркеры', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'edge.patch',
        clientOpId: randomUUID(),
        id: edgeId,
        patch: { style: { markerStart: 'arrow', markerEnd: 'dot' } },
      },
      BOARD_ID,
      ACTOR,
    );

    expect((state.edges.get(edgeId) as BoardEdge).style.markerStart).toBe('arrow');
    expect((state.edges.get(edgeId) as BoardEdge).style.markerEnd).toBe('dot');
  });

  it('патчит подпись связи', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      { type: 'edge.patch', clientOpId: randomUUID(), id: edgeId, patch: { label: 'зависит от' } },
      BOARD_ID,
      ACTOR,
    );

    expect((state.edges.get(edgeId) as BoardEdge).label).toBe('зависит от');
  });

  it('принимает многострочную подпись связи', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'edge.patch',
        clientOpId: randomUUID(),
        id: edgeId,
        patch: { label: 'Первая строка\nВторая строка' },
      },
      BOARD_ID,
      ACTOR,
    );

    expect((state.edges.get(edgeId) as BoardEdge).label).toBe('Первая строка\nВторая строка');
  });

  it('отклоняет слишком длинную подпись связи', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);
    const tooLong = 'x'.repeat(BOARD_EDGE_LABEL_MAX_LENGTH + 1);

    expect(() =>
      applyBoardOp(
        state,
        { type: 'edge.patch', clientOpId: randomUUID(), id: edgeId, patch: { label: tooLong } },
        BOARD_ID,
        ACTOR,
      ),
    ).toThrow(ValidationError);
  });

  it('удаляет связь', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      { type: 'edge.delete', clientOpId: randomUUID(), id: edgeId },
      BOARD_ID,
      ACTOR,
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
        ACTOR,
      ),
    ).toThrow(ValidationError);
  });

  it('принимает смещение изгиба кривой', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'edge.patch',
        clientOpId: randomUUID(),
        id: edgeId,
        patch: { style: { curveOffset: { x: 30, y: -15 } } },
      },
      BOARD_ID,
      ACTOR,
    );

    expect((state.edges.get(edgeId) as BoardEdge).style.curveOffset).toEqual({ x: 30, y: -15 });
  });

  it('связь без curveOffset в style получает null (обратная совместимость)', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    const op = edgeCreateOp(edgeId, a, b);
    (op as { edge: { style: unknown } }).edge.style = {
      color: '#A8CAFF',
      line: 'curved',
      dash: 'solid',
      markerStart: 'none',
      markerEnd: 'none',
    };

    applyBoardOp(state, op, BOARD_ID, ACTOR);

    expect((state.edges.get(edgeId) as BoardEdge).style.curveOffset).toBeNull();
  });

  it('отклоняет нечисловое смещение изгиба', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    const op = {
      type: 'edge.patch' as const,
      clientOpId: randomUUID(),
      id: edgeId,
      patch: { style: { curveOffset: { x: 'oops', y: 1 } } },
    } as unknown as BoardOp;

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет смещение изгиба за пределами лимита', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    expect(() =>
      applyBoardOp(
        state,
        {
          type: 'edge.patch',
          clientOpId: randomUUID(),
          id: edgeId,
          patch: { style: { curveOffset: { x: BOARD_EDGE_CURVE_OFFSET_MAX + 1, y: 0 } } },
        },
        BOARD_ID,
        ACTOR,
      ),
    ).toThrow(ValidationError);
  });

  it('явный null сбрасывает смещение изгиба', () => {
    const { state, a, b } = withTwoItems();
    const edgeId = randomUUID();
    applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'edge.patch',
        clientOpId: randomUUID(),
        id: edgeId,
        patch: { style: { curveOffset: { x: 50, y: 50 } } },
      },
      BOARD_ID,
      ACTOR,
    );
    expect((state.edges.get(edgeId) as BoardEdge).style.curveOffset).toEqual({ x: 50, y: 50 });

    applyBoardOp(
      state,
      {
        type: 'edge.patch',
        clientOpId: randomUUID(),
        id: edgeId,
        patch: { style: { curveOffset: null } },
      },
      BOARD_ID,
      ACTOR,
    );

    expect((state.edges.get(edgeId) as BoardEdge).style.curveOffset).toBeNull();
  });

  describe('validateEdgeStyle — labelOffset (12.18)', () => {
    it('принимает и сохраняет валидный labelOffset при edge.patch', () => {
      const { state, a, b } = withTwoItems();
      const edgeId = randomUUID();
      applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

      applyBoardOp(
        state,
        {
          type: 'edge.patch',
          clientOpId: randomUUID(),
          id: edgeId,
          patch: { style: { labelOffset: { x: 30, y: -15 } } },
        },
        BOARD_ID,
        ACTOR,
      );

      expect((state.edges.get(edgeId) as BoardEdge).style.labelOffset).toEqual({ x: 30, y: -15 });
    });

    it('labelOffset по умолчанию null, если ключ отсутствует в патче', () => {
      const { state, a, b } = withTwoItems();
      const edgeId = randomUUID();
      applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

      applyBoardOp(
        state,
        {
          type: 'edge.patch',
          clientOpId: randomUUID(),
          id: edgeId,
          patch: { label: 'зависит от' },
        },
        BOARD_ID,
        ACTOR,
      );

      expect((state.edges.get(edgeId) as BoardEdge).style.labelOffset).toBeNull();
    });

    it('отклоняет нечисловые x/y в labelOffset', () => {
      const { state, a, b } = withTwoItems();
      const edgeId = randomUUID();
      applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

      const op = {
        type: 'edge.patch' as const,
        clientOpId: randomUUID(),
        id: edgeId,
        patch: { style: { labelOffset: { x: 'oops', y: 1 } } },
      } as unknown as BoardOp;

      expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
    });

    it('отклоняет labelOffset за пределами BOARD_EDGE_LABEL_OFFSET_MAX', () => {
      const { state, a, b } = withTwoItems();
      const edgeId = randomUUID();
      applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

      expect(() =>
        applyBoardOp(
          state,
          {
            type: 'edge.patch',
            clientOpId: randomUUID(),
            id: edgeId,
            patch: { style: { labelOffset: { x: BOARD_EDGE_LABEL_OFFSET_MAX + 1, y: 0 } } },
          },
          BOARD_ID,
          ACTOR,
        ),
      ).toThrow(ValidationError);
    });

    it('явный сброс labelOffset в null поверх ранее заданного применяется', () => {
      const { state, a, b } = withTwoItems();
      const edgeId = randomUUID();
      applyBoardOp(state, edgeCreateOp(edgeId, a, b), BOARD_ID, ACTOR);

      applyBoardOp(
        state,
        {
          type: 'edge.patch',
          clientOpId: randomUUID(),
          id: edgeId,
          patch: { style: { labelOffset: { x: 50, y: 50 } } },
        },
        BOARD_ID,
        ACTOR,
      );
      expect((state.edges.get(edgeId) as BoardEdge).style.labelOffset).toEqual({ x: 50, y: 50 });

      applyBoardOp(
        state,
        {
          type: 'edge.patch',
          clientOpId: randomUUID(),
          id: edgeId,
          patch: { style: { labelOffset: null } },
        },
        BOARD_ID,
        ACTOR,
      );

      expect((state.edges.get(edgeId) as BoardEdge).style.labelOffset).toBeNull();
    });
  });
});

describe('applyBoardOp — батч операций подряд', () => {
  it('операции в одном батче видят изменения друг друга', () => {
    const state = emptyState();
    const id = randomUUID();

    applyBoardOp(state, stickyCreateOp(id), BOARD_ID, ACTOR);
    applyBoardOp(
      state,
      { type: 'item.patch', clientOpId: randomUUID(), id, patch: { x: 42 } },
      BOARD_ID,
      ACTOR,
    );
    applyBoardOp(state, { type: 'item.delete', clientOpId: randomUUID(), id }, BOARD_ID, ACTOR);

    expect(state.items.has(id)).toBe(false);
  });
});

describe('applyBoardOp — фреймы и группы (14.3)', () => {
  it('создаёт фрейм с заголовком и parentId: null', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, frameCreateOp(id, 'Мой фрейм'), BOARD_ID, ACTOR);

    const item = state.items.get(id)!;
    expect(item.content).toEqual({ type: 'frame', title: 'Мой фрейм' });
    expect(item.parentId).toBeNull();
  });

  it('создаёт группу (без заголовка) с parentId: null', () => {
    const state = emptyState();
    const id = randomUUID();
    applyBoardOp(state, groupCreateOp(id), BOARD_ID, ACTOR);

    const item = state.items.get(id)!;
    expect(item.content).toEqual({ type: 'group' });
    expect(item.parentId).toBeNull();
  });

  it('отклоняет фрейм с parentId != null (контейнер не может иметь родителя)', () => {
    const state = emptyState();
    const op = frameCreateOp(randomUUID());
    (op as { item: { parentId: unknown } }).item.parentId = randomUUID();

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('отклоняет группу с parentId != null', () => {
    const state = emptyState();
    const op = groupCreateOp(randomUUID());
    (op as { item: { parentId: unknown } }).item.parentId = randomUUID();

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('принимает элемент с parentId, указывающим на существующий фрейм', () => {
    const state = emptyState();
    const frameId = randomUUID();
    applyBoardOp(state, frameCreateOp(frameId), BOARD_ID, ACTOR);

    const childId = randomUUID();
    applyBoardOp(state, childItemOp(childId, frameId), BOARD_ID, ACTOR);

    const child = state.items.get(childId)!;
    expect(child.parentId).toBe(frameId);
  });

  it('принимает элемент с parentId, указывающим на существующую группу', () => {
    const state = emptyState();
    const groupId = randomUUID();
    applyBoardOp(state, groupCreateOp(groupId), BOARD_ID, ACTOR);

    const childId = randomUUID();
    applyBoardOp(state, childItemOp(childId, groupId), BOARD_ID, ACTOR);

    const child = state.items.get(childId)!;
    expect(child.parentId).toBe(groupId);
  });

  it('отклоняет элемент, чей parentId указывает на НЕ контейнер (стикер)', () => {
    const state = emptyState();
    const stickyId = randomUUID();
    applyBoardOp(state, stickyCreateOp(stickyId), BOARD_ID, ACTOR);

    const childId = randomUUID();
    expect(() => applyBoardOp(state, childItemOp(childId, stickyId), BOARD_ID, ACTOR)).toThrow(
      ValidationError,
    );
  });

  it('удаление контейнера осирает детей (parentId → null), не удаляя их', () => {
    const state = emptyState();
    const frameId = randomUUID();
    const childId = randomUUID();
    applyBoardOp(state, frameCreateOp(frameId), BOARD_ID, ACTOR);
    applyBoardOp(state, childItemOp(childId, frameId), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      { type: 'item.delete', clientOpId: randomUUID(), id: frameId },
      BOARD_ID,
      ACTOR,
    );

    expect(state.items.has(frameId)).toBe(false);
    const child = state.items.get(childId)!;
    expect(child.parentId).toBeNull();
  });

  it('item.patch поля, отличного от parentId, не трогает существующий parentId ребёнка', () => {
    const state = emptyState();
    const frameId = randomUUID();
    const childId = randomUUID();
    applyBoardOp(state, frameCreateOp(frameId), BOARD_ID, ACTOR);
    applyBoardOp(state, childItemOp(childId, frameId), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      { type: 'item.patch', clientOpId: randomUUID(), id: childId, patch: { x: 999 } },
      BOARD_ID,
      ACTOR,
    );

    expect(state.items.get(childId)!.parentId).toBe(frameId);
    expect(state.items.get(childId)!.x).toBe(999);
  });

  it('удаление контейнера осирает ребёнка ВНУТРИ БАТЧА — последующий item.patch того же батча видит уже осиротевшего ребёнка', () => {
    // Регрессия: applyBoardOp мутирует общий `state` последовательно op за op в
    // рамках одного батча (см. BoardOpState/board-ops.ts) — эта проверка
    // фиксирует, что item.delete контейнера орошает ребёнка НЕМЕДЛЕННО, а не
    // только по завершении батча, так что следующий item.patch того же батча
    // (например, пользователь двигал и контейнер, и ребёнка одним жестом)
    // применяется к уже актуальному parentId, не к устаревшему
    const state = emptyState();
    const frameId = randomUUID();
    const childId = randomUUID();
    applyBoardOp(state, frameCreateOp(frameId), BOARD_ID, ACTOR);
    applyBoardOp(state, childItemOp(childId, frameId), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      { type: 'item.delete', clientOpId: randomUUID(), id: frameId },
      BOARD_ID,
      ACTOR,
    );
    applyBoardOp(
      state,
      { type: 'item.patch', clientOpId: randomUUID(), id: childId, patch: { x: 999 } },
      BOARD_ID,
      ACTOR,
    );

    expect(state.items.has(frameId)).toBe(false);
    expect(state.items.get(childId)!.parentId).toBeNull();
    expect(state.items.get(childId)!.x).toBe(999);
  });

  it('patch item.parentId на существующий контейнер — ок', () => {
    const state = emptyState();
    const frameId = randomUUID();
    const childId = randomUUID();
    applyBoardOp(state, frameCreateOp(frameId), BOARD_ID, ACTOR);
    applyBoardOp(state, stickyCreateOp(childId), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      { type: 'item.patch', clientOpId: randomUUID(), id: childId, patch: { parentId: frameId } },
      BOARD_ID,
      ACTOR,
    );

    expect(state.items.get(childId)!.parentId).toBe(frameId);
  });

  it('patch item.parentId на несуществующий контейнер — отказ', () => {
    const state = emptyState();
    const childId = randomUUID();
    applyBoardOp(state, stickyCreateOp(childId), BOARD_ID, ACTOR);

    expect(() =>
      applyBoardOp(
        state,
        {
          type: 'item.patch',
          clientOpId: randomUUID(),
          id: childId,
          patch: { parentId: randomUUID() },
        },
        BOARD_ID,
        ACTOR,
      ),
    ).toThrow(ValidationError);
  });

  it('patch item.parentId в null — осирает элемент', () => {
    const state = emptyState();
    const frameId = randomUUID();
    const childId = randomUUID();
    applyBoardOp(state, frameCreateOp(frameId), BOARD_ID, ACTOR);
    applyBoardOp(state, childItemOp(childId, frameId), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      { type: 'item.patch', clientOpId: randomUUID(), id: childId, patch: { parentId: null } },
      BOARD_ID,
      ACTOR,
    );

    expect(state.items.get(childId)!.parentId).toBeNull();
  });

  it('отклоняет слишком длинный заголовок фрейма', () => {
    const state = emptyState();
    const op = frameCreateOp(randomUUID());
    (op as { item: { content: unknown } }).item.content = {
      type: 'frame',
      title: 'x'.repeat(201),
    };

    expect(() => applyBoardOp(state, op, BOARD_ID, ACTOR)).toThrow(ValidationError);
  });

  it('patch content.type с контейнера на обычный элемент осирает детей', () => {
    const state = emptyState();
    const frameId = randomUUID();
    const childId = randomUUID();
    applyBoardOp(state, frameCreateOp(frameId), BOARD_ID, ACTOR);
    applyBoardOp(state, childItemOp(childId, frameId), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'item.patch',
        clientOpId: randomUUID(),
        id: frameId,
        patch: { content: { type: 'sticky', text: '' } },
      },
      BOARD_ID,
      ACTOR,
    );

    const demoted = state.items.get(frameId)!;
    expect(demoted.content.type).toBe('sticky');
    expect(state.items.get(childId)!.parentId).toBeNull();
  });

  it('patch content.type с группы на обычный элемент осирает детей', () => {
    const state = emptyState();
    const groupId = randomUUID();
    const childId = randomUUID();
    applyBoardOp(state, groupCreateOp(groupId), BOARD_ID, ACTOR);
    applyBoardOp(state, childItemOp(childId, groupId), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'item.patch',
        clientOpId: randomUUID(),
        id: groupId,
        patch: { content: { type: 'sticky', text: '' } },
      },
      BOARD_ID,
      ACTOR,
    );

    expect(state.items.get(groupId)!.content.type).toBe('sticky');
    expect(state.items.get(childId)!.parentId).toBeNull();
  });

  it('patch content.type НЕ осирает, если тип остаётся контейнером (frame → group)', () => {
    const state = emptyState();
    const frameId = randomUUID();
    const childId = randomUUID();
    applyBoardOp(state, frameCreateOp(frameId), BOARD_ID, ACTOR);
    applyBoardOp(state, childItemOp(childId, frameId), BOARD_ID, ACTOR);

    applyBoardOp(
      state,
      {
        type: 'item.patch',
        clientOpId: randomUUID(),
        id: frameId,
        patch: { content: { type: 'group' } },
      },
      BOARD_ID,
      ACTOR,
    );

    expect(state.items.get(frameId)!.content.type).toBe('group');
    // Дети НЕ осираются — group тоже контейнер
    expect(state.items.get(childId)!.parentId).toBe(frameId);
  });
});
