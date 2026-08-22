/**
 * Юнит-тесты CRUD и жизненного цикла комнаты (создание, список, архивация,
 * удаление, история раундов) без БД: репозитории подменены заглушками. Правила
 * стола (голосование, раунды, вход) — в rooms-game.service.test.ts (16.5).
 */
import { randomUUID } from 'node:crypto';

import type { Room, Round } from '@poker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TeamAccess } from '../src/access';
import type { Db } from '../src/db';
import { ConflictError, ForbiddenError } from '../src/errors';
import { RoomsService } from '../src/rooms';
import { RoomsRepository } from '../src/rooms/rooms.repository';
import { RoomsTransactions } from '../src/rooms/rooms.transactions';
import { TeamsRepository } from '../src/teams';

// Идентификаторы приходят по сокету и проверяются на формат — берём настоящие uuid
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

const ROUND: Round = {
  id: randomUUID(),
  roomId: ROOM.id,
  seq: 1,
  deckType: 'fibonacci',
  status: 'voting',
  average: null,
  createdAt: new Date().toISOString(),
  revealedAt: null,
};

/**
 * Сервис с подменённым доступом к базе. Действия под блокировкой комнаты идут
 * в транзакции и заводят репозиторий сами, поэтому методы подменяются на
 * прототипе.
 */
function serviceWith(
  rooms: Partial<RoomsRepository> = {},
  teams: Partial<TeamsRepository> = {},
): RoomsService {
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  } as unknown as Db;

  for (const [method, implementation] of Object.entries(rooms)) {
    const spy = vi.spyOn(RoomsRepository.prototype, method as keyof RoomsRepository);
    spy.mockImplementation(implementation as never);
  }
  for (const [method, implementation] of Object.entries(teams)) {
    const spy = vi.spyOn(TeamsRepository.prototype, method as keyof TeamsRepository);
    spy.mockImplementation(implementation as never);
  }

  const teamAccess = new TeamAccess(teams as TeamsRepository);
  return new RoomsService(
    new RoomsRepository(db),
    teamAccess,
    new RoomsTransactions(db, teamAccess),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RoomsService: история раундов', () => {
  it('запрашивает голоса всех раундов одним батчем и сохраняет порядок истории', async () => {
    const newerRound: Round = {
      ...ROUND,
      id: randomUUID(),
      seq: 2,
      status: 'revealed',
      average: 8,
    };
    const olderRound: Round = { ...ROUND, status: 'revealed', average: 3 };
    const listVotesForRounds = vi.fn(
      async () =>
        new Map([
          [newerRound.id, [{ participantId: 'newer', name: 'Новый', value: 8 }]],
          [olderRound.id, [{ participantId: 'older', name: 'Старый', value: 3 }]],
        ]),
    );
    const listVotes = vi.fn(async () => []);
    const service = serviceWith({
      findRoom: async () => ROOM,
      listRevealedRounds: async () => [newerRound, olderRound],
      listVotesForRounds,
      listVotes,
    });

    const history = await service.listRoundHistory(ROOM.id);

    expect(listVotesForRounds).toHaveBeenCalledTimes(1);
    expect(listVotesForRounds).toHaveBeenCalledWith([newerRound.id, olderRound.id]);
    expect(listVotes).not.toHaveBeenCalled();
    expect(history.map((entry) => entry.round.id)).toEqual([newerRound.id, olderRound.id]);
  });

  it('пропускает раунд, голоса которого исчезли после вскрытия', async () => {
    const service = serviceWith({
      findRoom: async () => ROOM,
      listRevealedRounds: async () => [{ ...ROUND, status: 'revealed' as const }],
      listVotesForRounds: async () => new Map(),
    });

    await expect(service.listRoundHistory(ROOM.id)).resolves.toEqual([]);
  });
});

describe('RoomsService: архивация комнаты', () => {
  it('архивировать может только скрам-мастер', async () => {
    const service = serviceWith({ lockRoom: async () => ROOM });

    await expect(service.archiveRoom('user-other', ROOM.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('владелец архивирует свою комнату', async () => {
    const archiveRoom = vi.fn(async () => ({ ...ROOM, archivedAt: new Date().toISOString() }));
    const service = serviceWith({ lockRoom: async () => ROOM, archiveRoom });

    const archived = await service.archiveRoom('user-owner', ROOM.id);

    expect(archiveRoom).toHaveBeenCalledWith(ROOM.id);
    expect(archived.archivedAt).not.toBeNull();
  });

  it('повторная архивация уже архивной комнаты отклоняется конфликтом', async () => {
    const archivedRoom: Room = { ...ROOM, archivedAt: new Date().toISOString() };
    const service = serviceWith({ lockRoom: async () => archivedRoom });

    await expect(service.archiveRoom('user-owner', ROOM.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('админ команды архивирует комнату команды', async () => {
    const teamRoom: Room = { ...ROOM, teamId: 'team-1', creatorId: 'someone-else' };
    const archiveRoom = vi.fn(async () => ({ ...teamRoom, archivedAt: new Date().toISOString() }));
    const service = serviceWith(
      { lockRoom: async () => teamRoom, archiveRoom },
      {
        findMembership: vi.fn(async () => ({
          teamId: 'team-1',
          userId: 'user-admin',
          role: 'admin' as const,
        })),
      },
    );

    await service.archiveRoom('user-admin', teamRoom.id);

    expect(archiveRoom).toHaveBeenCalledWith(teamRoom.id);
  });
});

describe('RoomsService: настоящее удаление', () => {
  it('удалять может только скрам-мастер', async () => {
    const archivedRoom: Room = { ...ROOM, archivedAt: new Date().toISOString() };
    const service = serviceWith({ lockRoom: async () => archivedRoom });

    await expect(service.deleteRoomPermanently('user-other', ROOM.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('удалить можно только уже заархивированную комнату', async () => {
    const service = serviceWith({ lockRoom: async () => ROOM });

    await expect(service.deleteRoomPermanently('user-owner', ROOM.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('заархивированную комнату скрам-мастер удаляет насовсем', async () => {
    const archivedRoom: Room = { ...ROOM, archivedAt: new Date().toISOString() };
    const deleteArchivedRoom = vi.fn(async () => true);
    const service = serviceWith({ lockRoom: async () => archivedRoom, deleteArchivedRoom });

    await service.deleteRoomPermanently('user-owner', ROOM.id);

    expect(deleteArchivedRoom).toHaveBeenCalledWith(ROOM.id);
  });
});

describe('RoomsService: список комнат команды', () => {
  it('обычный список открыт рядовому участнику', async () => {
    const listRoomsByTeam = vi.fn(async () => [ROOM]);
    const service = serviceWith(
      { listRoomsByTeam },
      {
        findMembership: vi.fn(async () => ({
          teamId: 'team-1',
          userId: 'u',
          role: 'member' as const,
        })),
      },
    );

    await service.listTeamRooms('u', 'team-1');

    expect(listRoomsByTeam).toHaveBeenCalledWith('team-1', false);
  });

  it('архив команды рядовому участнику недоступен', async () => {
    const service = serviceWith(
      {},
      {
        findMembership: vi.fn(async () => ({
          teamId: 'team-1',
          userId: 'u',
          role: 'member' as const,
        })),
      },
    );

    await expect(service.listTeamRooms('u', 'team-1', true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('архив команды доступен администратору', async () => {
    const listRoomsByTeam = vi.fn(async () => [{ ...ROOM, archivedAt: new Date().toISOString() }]);
    const service = serviceWith(
      { listRoomsByTeam },
      {
        findMembership: vi.fn(async () => ({
          teamId: 'team-1',
          userId: 'u',
          role: 'admin' as const,
        })),
      },
    );

    const rooms = await service.listTeamRooms('u', 'team-1', true);

    expect(listRoomsByTeam).toHaveBeenCalledWith('team-1', true);
    expect(rooms[0]?.archivedAt).not.toBeNull();
  });
});
