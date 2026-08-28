import { randomUUID } from 'node:crypto';

import type { Board } from '@estimate/shared';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TeamAccess } from '../src/access';
import type { UsersRepository } from '../src/auth';
import { type BoardImagesService, BoardsService } from '../src/boards';
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

function serviceWith(
  options: {
    images?: BoardImagesService;
    log?: Pick<FastifyBaseLogger, 'warn'>;
  } = {},
): { service: BoardsService; transaction: ReturnType<typeof vi.fn> } {
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  const db = { transaction } as unknown as Db;
  const service = new BoardsService(
    db,
    new BoardsRepository(db),
    new TeamAccess({} as TeamsRepository),
    {} as UsersRepository,
    new GuestSessions('секрет-гостевых-сессий-для-тестов', 'boardGuest'),
    undefined,
    undefined,
    options.images,
    options.log,
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

describe('BoardsService: очистка картинок', () => {
  it('логирует сбой структурно и не пробрасывает его наружу', async () => {
    const deleteIfOwn = vi.fn(async () => {
      throw new Error('диск недоступен');
    });
    const warn = vi.fn();
    const { service } = serviceWith({
      images: { deleteIfOwn } as unknown as BoardImagesService,
      log: { warn },
    });

    await (
      service as unknown as {
        cleanupImages(boardId: string, urls: readonly string[]): Promise<void>;
      }
    ).cleanupImages(BOARD.id, ['/api/boards/image.webp']);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: BOARD.id,
        url: '/api/boards/image.webp',
        err: expect.any(Error),
      }),
      'Не удалось удалить файл картинки доски',
    );
  });
});
