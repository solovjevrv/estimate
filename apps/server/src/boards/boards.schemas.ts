import {
  BOARD_SHARE_ROLES,
  BOARD_TITLE_MAX_LENGTH,
  TEXT_INPUT_TRIM_ALLOWANCE,
} from '@poker/shared';

import { nullableUuidSchema } from '../http/schemas';

export const titleBody = {
  type: 'object',
  required: ['title'],
  properties: {
    // Настоящий предел длины проверяет сервис после обрезки пробелов
    title: {
      type: 'string',
      minLength: 1,
      maxLength: BOARD_TITLE_MAX_LENGTH + TEXT_INPUT_TRIM_ALLOWANCE,
    },
  },
} as const;

export const createBoardBody = {
  type: 'object',
  required: ['title'],
  properties: {
    title: {
      type: 'string',
      minLength: 1,
      maxLength: BOARD_TITLE_MAX_LENGTH + TEXT_INPUT_TRIM_ALLOWANCE,
    },
    teamId: nullableUuidSchema,
  },
} as const;

export const shareBody = {
  type: 'object',
  required: ['role'],
  properties: {
    role: { type: ['string', 'null'], enum: [...BOARD_SHARE_ROLES, null] },
  },
} as const;

export const boardResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    teamId: { type: ['string', 'null'] },
    ownerId: { type: ['string', 'null'] },
    title: { type: 'string' },
    status: { type: 'string' },
    revision: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    shareRole: { type: ['string', 'null'], enum: [...BOARD_SHARE_ROLES, null] },
  },
} as const;

export const boardSummaryResponse = {
  type: 'object',
  properties: { ...boardResponse.properties, itemCount: { type: 'integer' } },
} as const;

export const boardsResponse = {
  type: 'object',
  properties: { boards: { type: 'array', items: boardSummaryResponse } },
} as const;

// content/style — jsonb: конкретная форма растёт по мере эпиков (12.6+), поэтому
// намеренно не сужаем до конкретных полей здесь, чтобы схема ответа не глотала
// новые ключи будущих типов элементов молча
const jsonbResponse = { type: 'object', additionalProperties: true } as const;

export const boardItemResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    boardId: { type: 'string' },
    parentId: { type: ['string', 'null'] },
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    rotation: { type: 'number' },
    zIndex: { type: 'integer' },
    content: jsonbResponse,
    style: jsonbResponse,
    createdBy: { type: ['string', 'null'] },
    updatedAt: { type: 'string' },
  },
} as const;

export const boardEdgeResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    boardId: { type: 'string' },
    sourceItemId: { type: 'string' },
    targetItemId: { type: 'string' },
    sourceHandle: { type: ['string', 'null'] },
    targetHandle: { type: ['string', 'null'] },
    label: { type: ['string', 'null'] },
    style: jsonbResponse,
    zIndex: { type: 'integer' },
  },
} as const;

export const boardSnapshotResponse = {
  type: 'object',
  properties: {
    board: boardResponse,
    items: { type: 'array', items: boardItemResponse },
    edges: { type: 'array', items: boardEdgeResponse },
    access: { type: 'string' },
  },
} as const;
