import type { DeckType, TeamRole } from '@poker/shared';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema';

describe('схема БД', () => {
  it('содержит все сущности из ТЗ', () => {
    expect(getTableName(schema.users)).toBe('users');
    expect(getTableName(schema.teams)).toBe('teams');
    expect(getTableName(schema.teamMembers)).toBe('team_members');
    expect(getTableName(schema.rooms)).toBe('rooms');
    expect(getTableName(schema.rounds)).toBe('rounds');
    expect(getTableName(schema.votes)).toBe('votes');
  });

  it('комната может существовать без команды (team_id nullable)', () => {
    expect(getTableColumns(schema.rooms).teamId.notNull).toBe(false);
  });

  it('раунд принадлежит комнате, голос — раунду', () => {
    expect(getTableColumns(schema.rounds).roomId.notNull).toBe(true);
    expect(getTableColumns(schema.votes).roundId.notNull).toBe(true);
  });

  it('голос может быть и от пользователя, и от гостя', () => {
    const cols = getTableColumns(schema.votes);
    expect(cols.userId.notNull).toBe(false);
    expect(cols.guestSessionId.notNull).toBe(false);
    expect(cols.value.notNull).toBe(true);
  });

  it('типы колод соответствуют контракту @poker/shared', () => {
    // Присваивание типизировано: несовпадение с DeckType сломает компиляцию
    const deckValues: readonly DeckType[] = schema.deckTypeEnum.enumValues;
    expect(deckValues).toEqual(['fibonacci', 'scale_0_5']);
  });

  it('роли в команде соответствуют контракту @poker/shared', () => {
    const roleValues: readonly TeamRole[] = schema.teamRoleEnum.enumValues;
    expect(roleValues).toEqual(['admin', 'member', 'guest']);
  });
});
