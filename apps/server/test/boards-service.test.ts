import { randomUUID } from 'node:crypto';

import type { Board } from '@poker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TeamAccess } from '../src/access';
import type { UsersRepository } from '../src/auth';
import { BoardsService } from '../src/boards';
import { BoardsRepository } from '../src/boards/boards.repository';
import type { Db } from '../src/db';
import { GuestSessions } from '../src/platform/realtime';
import { TeamsRepository } from '../src/teams';

const BOARD: Board = {
  id: randomUUID(),
  teamId: 'team-1',
  ownerId: 'owner',
  title: 'Доска',
  status: 'active',
  revision: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  shareRole: null,
};

function serviceWith(): { service: BoardsService; transaction: ReturnType<typeof vi.fn> } {
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  const db = { transaction } as unknown as Db;
  const service = new BoardsService(
    db,
    new BoardsRepository(db),
    new TeamAccess({} as TeamsRepository),
    {} as UsersRepository,
    new GuestSessions('секрет-гостевых-сессий-для-тестов', 'boardGuest'),
  );
  return { service, transaction };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BoardsService.getSnapshot', () => {
  it('читает доску и членство только в одной read-only транзакции', async () => {
    const findBoard = vi.spyOn(BoardsRepository.prototype, 'findBoard').mockResolvedValue(BOARD);
    vi.spyOn(BoardsRepository.prototype, 'listItems').mockResolvedValue([]);
    vi.spyOn(BoardsRepository.prototype, 'listEdges').mockResolvedValue([]);
    const membership = vi
      .spyOn(TeamsRepository.prototype, 'findMembership')
      .mockResolvedValue({ teamId: 'team-1', userId: 'member', role: 'member' });

    const { service, transaction } = serviceWith();
    const snapshot = await service.getSnapshot('member', BOARD.id);

    expect(snapshot).toMatchObject({ board: BOARD, access: 'edit', items: [], edges: [] });
    expect(findBoard).toHaveBeenCalledTimes(1);
    expect(membership).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
  });
});
