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

const GUEST_SECRET = 'секрет-гостевых-сессий-для-тестов';

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
  linksVersion: 1,
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

/**
 * Сервис с подменённым доступом к базе. Действия за столом идут в транзакции и
 * заводят репозиторий сами, поэтому методы подменяются на прототипе.
 */
function serviceWith(
  rooms: Partial<RoomsRepository> = {},
  teams: Partial<TeamsRepository> = {},
  users: Partial<UsersRepository> = {},
): RoomsService {
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  } as unknown as Db;

  for (const [method, implementation] of Object.entries(rooms)) {
    const spy = vi.spyOn(RoomsRepository.prototype, method as keyof RoomsRepository);
    spy.mockImplementation(implementation as never);
  }

  return new RoomsService(
    db,
    new RoomsRepository(db),
    teams as TeamsRepository,
    users as UsersRepository,
    new GuestSessions(GUEST_SECRET),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
    findRoom: async () => ROOM,
    lockRoom: async () => ROOM,
    findCurrentRound: async () => ROUND,
    upsertUserVote: async () => {},
    upsertGuestVote: async () => {},
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
      findCurrentRound: async () => ({ ...ROUND, deckType: 'scale_0_5' as const }),
    });

    await expect(service.submitVote(ROOM.id, VOTER, 8)).rejects.toBeInstanceOf(ValidationError);
  });

  it('после вскрытия карт голосовать нельзя', async () => {
    const service = serviceWith({
      ...votingRepo,
      findCurrentRound: async () => ({ ...ROUND, status: 'revealed' as const }),
    });

    await expect(service.submitVote(ROOM.id, VOTER, 3)).rejects.toBeInstanceOf(ConflictError);
  });

  it('в закрытой комнате голосовать нельзя', async () => {
    const service = serviceWith({
      ...votingRepo,
      lockRoom: async () => ({ ...ROOM, status: 'closed' as const }),
    });

    await expect(service.submitVote(ROOM.id, VOTER, 3)).rejects.toBeInstanceOf(ConflictError);
  });

  it('исчезнувший раунд объясняется участнику, а не падает пятисоткой', async () => {
    const service = serviceWith({
      ...votingRepo,
      upsertUserVote: async () => {
        throw Object.assign(new Error('insert or update on table "votes" violates foreign key'), {
          cause: { code: '23503', constraint: 'votes_round_id_rounds_id_fk' },
        });
      },
    });

    await expect(service.submitVote(ROOM.id, VOTER, 3)).rejects.toBeInstanceOf(ConflictError);
  });

  it('голос удалённого аккаунта отклоняется с просьбой войти заново', async () => {
    const service = serviceWith({
      ...votingRepo,
      upsertUserVote: async () => {
        throw Object.assign(new Error('insert or update on table "votes" violates foreign key'), {
          cause: { code: '23503', constraint: 'votes_user_id_users_id_fk' },
        });
      },
    });

    await expect(service.submitVote(ROOM.id, VOTER, 3)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('RoomsService: права на управление раундом', () => {
  const tableRepo: Partial<RoomsRepository> = {
    lockRoom: async () => ROOM,
    findCurrentRound: async () => ROUND,
    listVotes: async () => [],
  };

  it('голосующий не может вскрыть карты и начать раунд', async () => {
    const service = serviceWith(tableRepo);

    await expect(service.revealCards(ROOM.id, VOTER)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.startNewRound(ROOM.id, VOTER, { deckType: 'fibonacci' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('скрам-мастеру отказывают уже не по правам, а по существу', async () => {
    const service = serviceWith(tableRepo);

    // Голосов нет — вскрывать нечего, но проверку прав создатель комнаты прошёл
    await expect(service.revealCards(ROOM.id, MASTER)).rejects.toBeInstanceOf(ConflictError);
  });

  it('роль перечитывается на действии: бывший админ команды теряет права', async () => {
    const teamRoom: Room = { ...ROOM, teamId: randomUUID(), creatorId: randomUUID() };
    const service = serviceWith(
      { ...tableRepo, lockRoom: async () => teamRoom },
      // На момент действия участник уже понижен до рядового
      {
        findMembership: vi.fn(async () => ({
          teamId: 'team',
          userId: 'u',
          role: 'member' as const,
        })),
      },
    );

    await expect(
      service.startNewRound(
        teamRoom.id,
        { ...MASTER, role: 'scrum_master' },
        { deckType: 'fibonacci' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('повторный старт того же раунда не плодит новые: стол уже ушёл вперёд', async () => {
    const started: Round = { ...ROUND, id: randomUUID(), seq: 2 };
    const insertRound = vi.fn(async () => started);
    const service = serviceWith({
      ...tableRepo,
      // Пока запрос ждал очереди, раунд уже сменили
      findCurrentRound: async () => started,
      insertRound,
    });

    const round = await service.startNewRound(ROOM.id, MASTER, {
      deckType: 'fibonacci',
      fromRoundId: ROUND.id,
    });

    expect(round.id).toBe(started.id);
    expect(insertRound).not.toHaveBeenCalled();
  });

  it('старт с актуального раунда создаёт следующий', async () => {
    const insertRound = vi.fn(async () => ({ ...ROUND, id: randomUUID(), seq: 2 }));
    const service = serviceWith({ ...tableRepo, insertRound });

    await service.startNewRound(ROOM.id, MASTER, {
      deckType: 'fibonacci',
      fromRoundId: ROUND.id,
    });

    expect(insertRound).toHaveBeenCalledWith(expect.objectContaining({ seq: 2 }));
  });
});

describe('RoomsService: вход за стол', () => {
  it('гость без имени за стол не садится', async () => {
    const service = serviceWith({ findRoom: async () => ROOM });

    await expect(
      service.prepareJoin({ roomId: ROOM.id, userId: null, guestName: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('гость возвращается со своим сессионным id', async () => {
    const service = serviceWith({ findRoom: async () => ROOM });

    const { identity } = await service.prepareJoin({
      roomId: ROOM.id,
      userId: null,
      guestName: '  Гость  ',
      guestToken: new GuestSessions(GUEST_SECRET).issue('guest-42'),
    });

    expect(identity).toMatchObject({
      participantId: 'guest-42',
      name: 'Гость',
      isGuest: true,
      role: 'voter',
    });
  });

  it('новому гостю выдаётся сессионный id', async () => {
    const service = serviceWith({ findRoom: async () => ROOM });

    const { identity } = await service.prepareJoin({
      roomId: ROOM.id,
      userId: null,
      guestName: 'Гость',
    });

    expect(identity.participantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('пользователь с удалённым аккаунтом за стол не попадает', async () => {
    const service = serviceWith(
      { findRoom: async () => ROOM },
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
    findRoom: async () => ROOM,
    lockRoom: async () => ROOM,
    findCurrentRound: async () => ROUND,
    updateRoundLinks: async (_id, links) => ({ ...ROUND, ...links }),
  };

  it('ссылка без схемы отклоняется', async () => {
    const service = serviceWith(repo);

    await expect(
      service.updateLinks(ROOM.id, { jiraUrl: 'jira.example.com/TASK-1' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('пустая строка убирает ссылку', async () => {
    const updateRoundLinks = vi.fn(async (_id: string, links: object) => ({ ...ROUND, ...links }));
    const service = serviceWith({ ...repo, updateRoundLinks });

    await service.updateLinks(ROOM.id, { jiraUrl: '  ' });

    expect(updateRoundLinks).toHaveBeenCalledWith(ROUND.id, { jiraUrl: null }, undefined);
  });

  it('корректная ссылка сохраняется', async () => {
    const service = serviceWith(repo);

    const round = await service.updateLinks(ROOM.id, {
      confluenceUrl: 'https://confluence.example.com/page',
    });

    expect(round.confluenceUrl).toBe('https://confluence.example.com/page');
  });

  it('правка поверх чужой отклоняется: версия ссылок устарела', async () => {
    const updateRoundLinks = vi.fn(async () => ROUND);
    const service = serviceWith({
      ...repo,
      // Пока участник печатал, ссылки уже поменяли
      findCurrentRound: async () => ({ ...ROUND, linksVersion: 5 }),
      updateRoundLinks,
    });

    await expect(
      service.updateLinks(ROOM.id, { jiraUrl: 'https://jira.example.com/TASK-9', version: 4 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(updateRoundLinks).not.toHaveBeenCalled();
  });

  it('правка с актуальной версией доходит до базы вместе с ней', async () => {
    const updateRoundLinks = vi.fn(async (_id: string, links: object) => ({ ...ROUND, ...links }));
    const service = serviceWith({ ...repo, updateRoundLinks });

    await service.updateLinks(ROOM.id, {
      jiraUrl: 'https://jira.example.com/TASK-9',
      version: ROUND.linksVersion,
    });

    expect(updateRoundLinks).toHaveBeenCalledWith(
      ROUND.id,
      { jiraUrl: 'https://jira.example.com/TASK-9' },
      ROUND.linksVersion,
    );
  });
});
