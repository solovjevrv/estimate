/**
 * Юнит-тесты общей для CRUD- и игровой части инфраструктуры (16.5): без БД,
 * репозитории подменены заглушками.
 */
import { randomUUID } from 'node:crypto';

import type { Room } from '@estimate/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TeamAccess } from '../src/access';
import type { Db } from '../src/db';
import { RoomsTransactions } from '../src/rooms/rooms.transactions';
import { TeamsRepository } from '../src/teams';

const ROOM: Room = {
  id: randomUUID(),
  teamId: null,
  creatorId: 'user-owner',
  name: 'Комната',
  status: 'active',
  revision: 0,
  createdAt: new Date().toISOString(),
  archivedAt: null,
  jiraUrl: null,
  confluenceUrl: null,
  linksVersion: 1,
};

function transactionsWith(teams: Partial<TeamsRepository> = {}): RoomsTransactions {
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  } as unknown as Db;
  for (const [method, implementation] of Object.entries(teams)) {
    const spy = vi.spyOn(TeamsRepository.prototype, method as keyof TeamsRepository);
    spy.mockImplementation(implementation as never);
  }
  return new RoomsTransactions(db, new TeamAccess(teams as TeamsRepository));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RoomsTransactions: роль в комнате', () => {
  it('создатель комнаты — скрам-мастер, остальные голосуют', async () => {
    const transactions = transactionsWith();

    expect(await transactions.resolveRole(ROOM, 'user-owner')).toBe('scrum_master');
    expect(await transactions.resolveRole(ROOM, 'user-other')).toBe('voter');
    expect(await transactions.resolveRole(ROOM, null)).toBe('voter');
  });

  it('в командной комнате скрам-мастером становится и администратор команды', async () => {
    const teamRoom: Room = { ...ROOM, teamId: 'team-1', creatorId: 'user-owner' };
    const transactions = transactionsWith({
      findMembership: vi.fn(async (_teamId: string, userId: string) =>
        userId === 'user-admin'
          ? { teamId: 'team-1', userId, role: 'admin' as const }
          : { teamId: 'team-1', userId, role: 'member' as const },
      ),
    });

    expect(await transactions.resolveRole(teamRoom, 'user-admin')).toBe('scrum_master');
    expect(await transactions.resolveRole(teamRoom, 'user-member')).toBe('voter');
  });
});
