/**
 * Юнит-тесты правил комнаты без БД: репозитории подменены заглушками.
 */
import { randomUUID } from 'node:crypto';

import type { Room, Round } from '@poker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UsersRepository } from '../src/auth';
import type { Db } from '../src/db';
import { ConflictError, ForbiddenError, ValidationError } from '../src/errors';
import type { ParticipantIdentity } from '../src/rooms';
import { GuestSessions, RoomsService } from '../src/rooms';
import { RoomsRepository } from '../src/rooms/rooms.repository';
import type { TeamsRepository } from '../src/teams';

// Идентификаторы приходят по сокету и проверяются на формат — берём настоящие uuid
const ROOM: Room = {
  id: randomUUID(),
  teamId: null,
  creatorId: 'user-owner',
  name: 'Комната',
  status: 'active',
  createdAt: new Date().toISOString(),
};

const ROUND: Round = {
  id: randomUUID(),
  roomId: ROOM.id,
  seq: 1,
  deckType: 'fibonacci',
  jiraUrl: null,
  confluenceUrl: null,
  status: 'voting',
  average: null,
  createdAt: new Date().toISOString(),
  revealedAt: null,
};

const VOTER: ParticipantIdentity = {
  participantId: 'user-voter',
  userId: 'user-voter',
  name: 'Голосующий',
  avatarUrl: null,
  isGuest: false,
  role: 'voter',
};

const MASTER: ParticipantIdentity = {
  ...VOTER,
  participantId: 'user-owner',
  userId: 'user-owner',
  role: 'scrum_master',
};

function serviceWith(
  rooms: Partial<RoomsRepository> = {},
  teams: Partial<TeamsRepository> = {},
  users: Partial<UsersRepository> = {},
): RoomsService {
  return new RoomsService(
    {} as Db,
    rooms as RoomsRepository,
    teams as TeamsRepository,
    users as UsersRepository,
    new GuestSessions('секрет-гостевых-сессий-для-тестов'),
  );
}

describe('RoomsService: роль в комнате', () => {
  it('создатель комнаты — скрам-мастер, остальные голосуют', async () => {
    const service = serviceWith();

    expect(await service.resolveRole(ROOM, 'user-owner')).toBe('scrum_master');
    expect(await service.resolveRole(ROOM, 'user-other')).toBe('voter');
    expect(await service.resolveRole(ROOM, null)).toBe('voter');
  });

  it('в командной комнате скрам-мастером становится и администратор команды', async () => {
    const teamRoom: Room = { ...ROOM, teamId: 'team-1', creatorId: 'user-owner' };
    const service = serviceWith(
      {},
      {
        findMembership: vi.fn(async (_teamId: string, userId: string) =>
          userId === 'user-admin'
            ? { teamId: 'team-1', userId, role: 'admin' as const }
            : { teamId: 'team-1', userId, role: 'member' as const },
        ),
      },
    );

    expect(await service.resolveRole(teamRoom, 'user-admin')).toBe('scrum_master');
    expect(await service.resolveRole(teamRoom, 'user-member')).toBe('voter');
  });
});

describe('RoomsService: голосование', () => {
  const votingRepo: Partial<RoomsRepository> = {
    findRoom: vi.fn(async () => ROOM),
    findCurrentRound: vi.fn(async () => ROUND),
    upsertUserVote: vi.fn(async () => {}),
    upsertGuestVote: vi.fn(async () => {}),
  };

  it('дробная и отрицательная оценки отклоняются', async () => {
    const service = serviceWith(votingRepo);

    await expect(service.submitVote(ROOM.id, VOTER, 2.5)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.submitVote(ROOM.id, VOTER, -1)).rejects.toBeInstanceOf(ValidationError);
  });

  it('у колоды Фибоначчи можно поставить своё число', async () => {
    const upsertUserVote = vi.fn(async () => {});
    const service = serviceWith({ ...votingRepo, upsertUserVote });

    await service.submitVote(ROOM.id, VOTER, 40);

    expect(upsertUserVote).toHaveBeenCalledWith(ROUND.id, VOTER.participantId, 40);
  });

  it('у шкалы 0–5 значения выше пяти отклоняются', async () => {
    const service = serviceWith({
      ...votingRepo,
      findCurrentRound: vi.fn(async () => ({ ...ROUND, deckType: 'scale_0_5' as const })),
    });

    await expect(service.submitVote(ROOM.id, VOTER, 8)).rejects.toBeInstanceOf(ValidationError);
  });

  it('после вскрытия карт голосовать нельзя', async () => {
    const service = serviceWith({
      ...votingRepo,
      findCurrentRound: vi.fn(async () => ({ ...ROUND, status: 'revealed' as const })),
    });

    await expect(service.submitVote(ROOM.id, VOTER, 3)).rejects.toBeInstanceOf(ConflictError);
  });

  it('в закрытой комнате голосовать нельзя', async () => {
    const service = serviceWith({
      ...votingRepo,
      findRoom: vi.fn(async () => ({ ...ROOM, status: 'closed' as const })),
    });

    await expect(service.submitVote(ROOM.id, VOTER, 3)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('RoomsService: права на управление раундом', () => {
  /** Сервис с транзакцией-заглушкой: внутри неё репозиторий создаётся сам */
  function serviceInTransaction(): RoomsService {
    vi.spyOn(RoomsRepository.prototype, 'lockRoom').mockResolvedValue(ROOM);
    vi.spyOn(RoomsRepository.prototype, 'findCurrentRound').mockResolvedValue(ROUND);
    vi.spyOn(RoomsRepository.prototype, 'listVotes').mockResolvedValue([]);
    const db = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    } as unknown as Db;
    return new RoomsService(
      db,
      new RoomsRepository(db),
      {} as TeamsRepository,
      {} as UsersRepository,
      new GuestSessions('секрет-гостевых-сессий-для-тестов'),
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('голосующий не может вскрыть карты и начать раунд', async () => {
    const service = serviceInTransaction();

    await expect(service.revealCards(ROOM.id, VOTER)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.startNewRound(ROOM.id, VOTER, { deckType: 'fibonacci' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('скрам-мастеру отказывают уже не по правам, а по существу', async () => {
    const service = serviceInTransaction();

    // Голосов нет — вскрывать нечего, но проверку прав создатель комнаты прошёл
    await expect(service.revealCards(ROOM.id, MASTER)).rejects.toBeInstanceOf(ConflictError);
  });

  it('роль перечитывается на действии: бывший админ команды теряет права', async () => {
    const teamRoom: Room = { ...ROOM, teamId: randomUUID(), creatorId: randomUUID() };
    vi.spyOn(RoomsRepository.prototype, 'lockRoom').mockResolvedValue(teamRoom);
    vi.spyOn(RoomsRepository.prototype, 'findCurrentRound').mockResolvedValue(ROUND);
    const db = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    } as unknown as Db;
    const service = new RoomsService(
      db,
      new RoomsRepository(db),
      // На момент действия участник уже понижен до рядового
      {
        findMembership: vi.fn(async () => ({ teamId: 'team', userId: 'u', role: 'member' })),
      } as unknown as TeamsRepository,
      {} as UsersRepository,
      new GuestSessions('секрет'),
    );

    await expect(
      service.startNewRound(
        teamRoom.id,
        { ...MASTER, role: 'scrum_master' },
        { deckType: 'fibonacci' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('RoomsService: вход за стол', () => {
  it('гость без имени за стол не садится', async () => {
    const service = serviceWith({ findRoom: vi.fn(async () => ROOM) });

    await expect(
      service.prepareJoin({ roomId: ROOM.id, userId: null, guestName: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('гость возвращается со своим сессионным id', async () => {
    const service = serviceWith({ findRoom: vi.fn(async () => ROOM) });

    const { identity } = await service.prepareJoin({
      roomId: ROOM.id,
      userId: null,
      guestName: '  Гость  ',
      guestToken: new GuestSessions('секрет-гостевых-сессий-для-тестов').issue('guest-42'),
    });

    expect(identity).toMatchObject({
      participantId: 'guest-42',
      name: 'Гость',
      isGuest: true,
      role: 'voter',
    });
  });

  it('новому гостю выдаётся сессионный id', async () => {
    const service = serviceWith({ findRoom: vi.fn(async () => ROOM) });

    const { identity } = await service.prepareJoin({
      roomId: ROOM.id,
      userId: null,
      guestName: 'Гость',
    });

    expect(identity.participantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('пользователь с удалённым аккаунтом за стол не попадает', async () => {
    const service = serviceWith(
      { findRoom: vi.fn(async () => ROOM) },
      {},
      { findById: vi.fn(async () => null) },
    );

    await expect(service.prepareJoin({ roomId: ROOM.id, userId: 'ghost' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe('RoomsService: ссылки на задачу', () => {
  const repo: Partial<RoomsRepository> = {
    findRoom: vi.fn(async () => ROOM),
    findCurrentRound: vi.fn(async () => ROUND),
    updateRoundLinks: vi.fn(async (_id: string, links) => ({ ...ROUND, ...links })),
  };

  it('ссылка без схемы отклоняется', async () => {
    const service = serviceWith(repo);

    await expect(
      service.updateLinks(ROOM.id, { jiraUrl: 'jira.example.com/TASK-1' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('пустая строка убирает ссылку', async () => {
    const updateRoundLinks = vi.fn(async (_id: string, links) => ({ ...ROUND, ...links }));
    const service = serviceWith({ ...repo, updateRoundLinks });

    await service.updateLinks(ROOM.id, { jiraUrl: '  ' });

    expect(updateRoundLinks).toHaveBeenCalledWith(ROUND.id, { jiraUrl: null });
  });

  it('корректная ссылка сохраняется', async () => {
    const updateRoundLinks = vi.fn(async (_id: string, links) => ({ ...ROUND, ...links }));
    const service = serviceWith({ ...repo, updateRoundLinks });

    const round = await service.updateLinks(ROOM.id, {
      confluenceUrl: 'https://confluence.example.com/page',
    });

    expect(round.confluenceUrl).toBe('https://confluence.example.com/page');
  });
});
