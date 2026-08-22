import { TEAM_ROLES } from '@poker/shared';

import { uuidSchema } from '../http/schemas';

export const memberParams = {
  type: 'object',
  required: ['id', 'userId'],
  properties: { id: uuidSchema, userId: uuidSchema },
} as const;

export const inviteParams = {
  type: 'object',
  required: ['code'],
  properties: { code: { type: 'string', pattern: '^[A-Za-z0-9_-]{6,64}$' } },
} as const;

export const nameBody = {
  type: 'object',
  required: ['name'],
  properties: {
    // Здесь только защита от гигантских тел; настоящий предел длины
    // проверяет сервис уже после обрезки пробелов
    name: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const roleBody = {
  type: 'object',
  required: ['role'],
  properties: { role: { type: 'string', enum: [...TEAM_ROLES] } },
} as const;

// Схемы ответов задают и контракт, и фильтр сериализации: лишние поля
// (например, код приглашения) не смогут утечь при будущих правках.
export const teamResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    createdAt: { type: 'string' },
  },
} as const;

export const teamWithRoleResponse = {
  type: 'object',
  properties: {
    ...teamResponse.properties,
    role: { type: 'string' },
    memberCount: { type: 'number' },
  },
} as const;

export const memberResponse = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
    avatarUrl: { type: ['string', 'null'] },
    role: { type: 'string' },
    joinedAt: { type: 'string' },
  },
} as const;

export const membersResponse = {
  type: 'object',
  properties: { members: { type: 'array', items: memberResponse } },
} as const;

export const memberProfileResponse = {
  type: 'object',
  properties: {
    ...memberResponse.properties,
    provider: { type: 'string' },
    jobTitle: { type: ['string', 'null'] },
  },
} as const;
