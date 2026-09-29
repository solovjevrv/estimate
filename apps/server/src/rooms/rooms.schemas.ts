import { ROOM_NAME_MAX_LENGTH, TEXT_INPUT_TRIM_ALLOWANCE } from '@estimate/shared';

import { nullableUuidSchema } from '../http/schemas';

export const createRoomBody = {
  type: 'object',
  required: ['name'],
  properties: {
    // Настоящий предел длины проверяет сервис после обрезки пробелов
    name: {
      type: 'string',
      minLength: 1,
      maxLength: ROOM_NAME_MAX_LENGTH + TEXT_INPUT_TRIM_ALLOWANCE,
    },
    teamId: nullableUuidSchema,
  },
} as const;

export const nameBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: ROOM_NAME_MAX_LENGTH + TEXT_INPUT_TRIM_ALLOWANCE,
    },
  },
} as const;

export const roomResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    teamId: { type: ['string', 'null'] },
    creatorId: { type: ['string', 'null'] },
    name: { type: 'string' },
    status: { type: 'string' },
    revision: { type: 'integer' },
    createdAt: { type: 'string' },
    archivedAt: { type: ['string', 'null'] },
  },
} as const;

export const roomsResponse = {
  type: 'object',
  properties: { rooms: { type: 'array', items: roomResponse } },
} as const;

export const roomStatsResponse = {
  type: 'object',
  properties: {
    roundsPlayed: { type: 'integer' },
    tasksEstimated: { type: 'integer' },
    avgRoundDurationSec: { type: ['number', 'null'] },
  },
} as const;

export const roundResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    roomId: { type: 'string' },
    seq: { type: 'integer' },
    deckType: { type: 'string' },
    status: { type: 'string' },
    average: { type: ['number', 'null'] },
    createdAt: { type: 'string' },
    revealedAt: { type: ['string', 'null'] },
  },
} as const;

export const roundResultResponse = {
  type: 'object',
  properties: {
    average: { type: ['number', 'null'] },
    min: { type: 'number' },
    max: { type: 'number' },
    agreement: { type: 'number' },
    votes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          participantId: { type: 'string' },
          name: { type: 'string' },
          value: { type: 'number' },
        },
      },
    },
  },
} as const;

export const roundHistoryResponse = {
  type: 'object',
  properties: {
    rounds: {
      type: 'array',
      items: {
        type: 'object',
        properties: { round: roundResponse, result: roundResultResponse },
      },
    },
  },
} as const;
