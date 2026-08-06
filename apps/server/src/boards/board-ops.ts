/**
 * Применение операций доски — чистая логика без БД (12.4). `BoardsService`
 * загружает текущие элементы/связи в `BoardOpState`, прогоняет через
 * `applyBoardOp` весь батч по очереди (валидирует и мутирует состояние),
 * а затем персистит результат. Ошибка любой операции в батче отклоняет
 * его целиком — уже проверенные предыдущие операции в этом же вызове
 * при этом не сохраняются, так как персистится только валидный батч.
 */
import {
  BOARD_COLOR_HEX_PATTERN,
  BOARD_EDGE_LINE_KINDS,
  BOARD_ITEM_TEXT_MAX_LENGTH,
  BOARD_MAX_ITEMS,
  BOARD_SHAPE_KINDS,
  type BoardEdge,
  type BoardItem,
  type BoardItemContent,
  type BoardItemStyle,
  type BoardOp,
} from '@poker/shared';

import { ValidationError } from '../errors';

export interface BoardOpState {
  items: Map<string, BoardItem>;
  edges: Map<string, BoardEdge>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COORDINATE = 1_000_000;
const MAX_SIZE = 10_000;

function requireUuid(id: unknown, what: string): string {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new ValidationError(`Некорректный id ${what}`);
  }
  return id;
}

function requireFinite(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(`Некорректное значение поля «${field}»`);
  }
  return value;
}

/**
 * Цвет — hex-строка `#RRGGBB` (12.7, не токен из белого списка — пользователь
 * может выбрать произвольный цвет). Формат проверяется строгим regex'ом:
 * `#RRGGBB` физически не может нести ничего, кроме шести hex-цифр, так что
 * далее это значение безопасно использовать как CSS-цвет на клиенте.
 */
function requireColorHex(color: unknown, what: string): string {
  if (typeof color !== 'string' || !BOARD_COLOR_HEX_PATTERN.test(color)) {
    throw new ValidationError(`Недопустимый цвет ${what}`);
  }
  return color;
}

function validateStyle(style: unknown): BoardItemStyle {
  if (typeof style !== 'object' || style === null) {
    throw new ValidationError('Не указан стиль элемента');
  }
  const color = requireColorHex((style as { color?: unknown }).color, 'элемента');
  return { color };
}

function validateEdgeStyle(style: unknown): BoardEdge['style'] {
  if (typeof style !== 'object' || style === null) {
    throw new ValidationError('Не указан стиль связи');
  }
  const { color, line } = style as { color?: unknown; line?: unknown };
  const validColor = requireColorHex(color, 'связи');
  if (!(BOARD_EDGE_LINE_KINDS as readonly unknown[]).includes(line)) {
    throw new ValidationError('Недопустимый тип линии связи');
  }
  return { color: validColor, line } as BoardEdge['style'];
}

function validateContent(content: unknown): BoardItemContent {
  if (typeof content !== 'object' || content === null) {
    throw new ValidationError('Не указано содержимое элемента');
  }
  const c = content as { type?: unknown; text?: unknown; shape?: unknown };
  if (typeof c.text !== 'string' || c.text.length > BOARD_ITEM_TEXT_MAX_LENGTH) {
    throw new ValidationError('Слишком длинный текст элемента');
  }
  if (c.type === 'sticky') {
    return { type: 'sticky', text: c.text };
  }
  if (c.type === 'shape') {
    if (!(BOARD_SHAPE_KINDS as readonly unknown[]).includes(c.shape)) {
      throw new ValidationError('Недопустимая форма фигуры');
    }
    return { type: 'shape', shape: c.shape as (typeof BOARD_SHAPE_KINDS)[number], text: c.text };
  }
  throw new ValidationError('Неизвестный тип элемента');
}

/** Геометрия общая для стикера и фигуры — валидируется одинаково независимо от типа содержимого */
function validateGeometry(item: {
  x: unknown;
  y: unknown;
  width: unknown;
  height: unknown;
  rotation: unknown;
  zIndex: unknown;
  parentId: unknown;
}): Pick<BoardItem, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'zIndex' | 'parentId'> {
  if (item.parentId !== null) {
    // Фреймы/группы — 14.3, столбец заведён заранее, но применять его пока нельзя
    throw new ValidationError('Группировка элементов пока не поддерживается');
  }
  return {
    x: requireFinite(item.x, 'x', -MAX_COORDINATE, MAX_COORDINATE),
    y: requireFinite(item.y, 'y', -MAX_COORDINATE, MAX_COORDINATE),
    width: requireFinite(item.width, 'width', 1, MAX_SIZE),
    height: requireFinite(item.height, 'height', 1, MAX_SIZE),
    rotation: requireFinite(item.rotation, 'rotation', -360, 360),
    zIndex: requireFinite(item.zIndex, 'zIndex', -1_000_000, 1_000_000),
    parentId: null,
  };
}

/**
 * Применяет одну операцию к состоянию доски: валидирует и мутирует `state`
 * на месте. Бросает `ValidationError`/`NotFoundError`-подобные ошибки
 * (см. `../errors`) на любое несоответствие — вызывающий код должен
 * прерывать применение всего батча при первой же ошибке.
 */
export function applyBoardOp(
  state: BoardOpState,
  op: BoardOp,
  boardId: string,
  actorId: string,
): void {
  switch (op.type) {
    case 'item.create': {
      const id = requireUuid(op.item.id, 'элемента');
      if (state.items.has(id)) {
        throw new ValidationError('Элемент с таким id уже существует');
      }
      if (state.items.size >= BOARD_MAX_ITEMS) {
        throw new ValidationError(`Превышен лимит элементов на доске (${BOARD_MAX_ITEMS})`);
      }
      const geometry = validateGeometry(op.item);
      const item: BoardItem = {
        id,
        boardId,
        ...geometry,
        content: validateContent(op.item.content),
        style: validateStyle(op.item.style),
        createdBy: actorId,
        updatedAt: new Date().toISOString(),
      };
      state.items.set(id, item);
      break;
    }
    case 'item.patch': {
      const existing = state.items.get(op.id);
      if (!existing) {
        throw new ValidationError('Элемент не найден');
      }
      const merged = { ...existing, ...op.patch };
      const geometry = validateGeometry(merged);
      const item: BoardItem = {
        ...existing,
        ...geometry,
        content:
          op.patch.content !== undefined ? validateContent(merged.content) : existing.content,
        style: op.patch.style !== undefined ? validateStyle(merged.style) : existing.style,
        updatedAt: new Date().toISOString(),
      };
      state.items.set(op.id, item);
      break;
    }
    case 'item.delete': {
      if (!state.items.delete(op.id)) {
        throw new ValidationError('Элемент не найден');
      }
      // Связи существуют только вместе со своими элементами — БД удалит их каскадом,
      // но в состоянии текущего батча их тоже нужно убрать сразу: иначе следующая
      // в этом же батче операция ещё «видела» бы удалённый элемент через связь
      for (const [edgeId, edge] of state.edges) {
        if (edge.sourceItemId === op.id || edge.targetItemId === op.id) {
          state.edges.delete(edgeId);
        }
      }
      break;
    }
    case 'edge.create': {
      const id = requireUuid(op.edge.id, 'связи');
      if (state.edges.has(id)) {
        throw new ValidationError('Связь с таким id уже существует');
      }
      const sourceItemId = requireUuid(op.edge.sourceItemId, 'исходного элемента');
      const targetItemId = requireUuid(op.edge.targetItemId, 'целевого элемента');
      if (sourceItemId === targetItemId) {
        throw new ValidationError('Связь не может соединять элемент с самим собой');
      }
      if (!state.items.has(sourceItemId) || !state.items.has(targetItemId)) {
        throw new ValidationError('Элемент связи не найден на доске');
      }
      state.edges.set(id, {
        id,
        boardId,
        sourceItemId,
        targetItemId,
        sourceHandle: op.edge.sourceHandle ?? null,
        targetHandle: op.edge.targetHandle ?? null,
        label: op.edge.label ?? null,
        style: validateEdgeStyle(op.edge.style),
      });
      break;
    }
    case 'edge.patch': {
      const existing = state.edges.get(op.id);
      if (!existing) {
        throw new ValidationError('Связь не найдена');
      }
      const merged = { ...existing, ...op.patch };
      state.edges.set(op.id, {
        ...existing,
        sourceHandle: merged.sourceHandle ?? null,
        targetHandle: merged.targetHandle ?? null,
        label: merged.label ?? null,
        style: op.patch.style !== undefined ? validateEdgeStyle(merged.style) : existing.style,
      });
      break;
    }
    case 'edge.delete': {
      if (!state.edges.delete(op.id)) {
        throw new ValidationError('Связь не найдена');
      }
      break;
    }
  }
}
