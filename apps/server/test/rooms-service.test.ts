/**
 * Юнит-тесты правил комнаты без БД: репозитории подменены заглушками.
 */
import { randomUUID } from 'node:crypto';

import type { Room, Round } from '@poker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UsersRepository } from '../src/auth';
import type { Db } from '../src/db';
import { ConflictError, ForbiddenError, ValidationError } from '../src/errors';
import { GuestSessions } from '../src/platform/realtime';
import type { ParticipantIdentity } from '../src/rooms';
import { RoomsService } from '../src/rooms';
import { RoomsRepository } from '../src/rooms/rooms.repository';
import { TeamsRepository } from '../src/teams';

const GUEST_SECRET = 'секрет-гостевых-сессий-для-тестов';

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

  // Действие за столом отмечается в комнате — в юнит-тестах базы нет
  vi.spyOn(RoomsRepository.prototype, 'bumpRevision').mockResolvedValue();
  for (const [method, implementation] of Object.entries(rooms)) {
    const spy = vi.spyOn(RoomsRepository.prototype, method as keyof RoomsRepository);
    spy.mockImplementation(implementation as never);
  }
  for (const [method, implementation] of Object.entries(teams)) {
    const spy = vi.spyOn(TeamsRepository.prototype, method as keyof TeamsRepository);
    spy.mockImplementation(implementation as never);
  }

  return new RoomsService(
    db,
    new RoomsRepository(db),
    teams as TeamsRepository,
    users as UsersRepository,
    new GuestSessions(GUEST_SECRET, 'guest'),
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

    await expect(service.submitVote(ROOM.id, VOTER, { value: 2.5 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.submitVote(ROOM.id, VOTER, { value: -1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('у колоды Фибоначчи можно поставить своё число', async () => {
    const upsertUserVote = vi.fn(async () => {});
    const service = serviceWith({ ...votingRepo, upsertUserVote });

    await service.submitVote(ROOM.id, VOTER, { value: 40 });

    expect(upsertUserVote).toHaveBeenCalledWith(ROUND.id, VOTER.participantId, 40);
  });

  it('у шкалы 0–5 значения выше пяти отклоняются', async () => {
    const service = serviceWith({
      ...votingRepo,
      findCurrentRound: async () => ({ ...ROUND, deckType: 'scale_0_5' as const }),
    });

    await expect(service.submitVote(ROOM.id, VOTER, { value: 8 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('у футболочных размеров можно поставить только число из колоды', async () => {
    const upsertUserVote = vi.fn(async () => {});
    const service = serviceWith({
      ...votingRepo,
      findCurrentRound: async () => ({ ...ROUND, deckType: 'tshirt' as const }),
      upsertUserVote,
    });

    await expect(service.submitVote(ROOM.id, VOTER, { value: 40 })).rejects.toBeInstanceOf(
      ValidationError,
    );

    await service.submitVote(ROOM.id, VOTER, { value: 5 });
    expect(upsertUserVote).toHaveBeenCalledWith(ROUND.id, VOTER.participantId, 5);
  });

  it('после вскрытия карт голосовать нельзя', async () => {
    const service = serviceWith({
      ...votingRepo,
      findCurrentRound: async () => ({ ...ROUND, status: 'revealed' as const }),
    });

    await expect(service.submitVote(ROOM.id, VOTER, { value: 3 })).rejects.toBeInstanceOf(
      ConflictError,
    );
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

    await expect(service.submitVote(ROOM.id, VOTER, { value: 3 })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('оценка за прошлый раунд не попадает в новую задачу', async () => {
    const upsertUserVote = vi.fn(async () => {});
    const service = serviceWith({ ...votingRepo, upsertUserVote });

    await expect(
      service.submitVote(ROOM.id, VOTER, { value: 3, roundId: randomUUID() }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(upsertUserVote).not.toHaveBeenCalled();
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

    await expect(service.submitVote(ROOM.id, VOTER, { value: 3 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
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

  it('вскрытие чужой задачи отклоняется', async () => {
    const markRevealed = vi.fn(async () => ROUND);
    const service = serviceWith({
      ...tableRepo,
      listVotes: async () => [{ participantId: 'user-voter', name: 'Кто-то', value: 3 }],
      markRevealed,
    });

    await expect(
      service.revealCards(ROOM.id, MASTER, { roundId: randomUUID() }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(markRevealed).not.toHaveBeenCalled();
  });

  it('первый раунд начинается с fromRoundId: null', async () => {
    const insertRound = vi.fn(async () => ROUND);
    const service = serviceWith({
      ...tableRepo,
      findCurrentRound: async () => null,
      insertRound,
    });

    await service.startNewRound(ROOM.id, MASTER, { deckType: 'fibonacci', fromRoundId: null });

    expect(insertRound).toHaveBeenCalledWith(expect.objectContaining({ seq: 1 }));
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
      guestToken: new GuestSessions(GUEST_SECRET, 'guest').issue(ROOM.id, 'guest-42'),
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
    updateRoomLinks: async (_id, links) => ({ ...ROOM, ...links }),
  };

  it('ссылка без схемы отклоняется', async () => {
    const service = serviceWith(repo);

    await expect(
      service.updateLinks(ROOM.id, { jiraUrl: 'jira.example.com/TASK-1' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('пустая строка убирает ссылку', async () => {
    const updateRoomLinks = vi.fn(async (_id: string, links: object) => ({ ...ROOM, ...links }));
    const service = serviceWith({ ...repo, updateRoomLinks });

    await service.updateLinks(ROOM.id, { jiraUrl: '  ' });

    expect(updateRoomLinks).toHaveBeenCalledWith(ROOM.id, { jiraUrl: null }, undefined);
  });

  it('корректная ссылка сохраняется', async () => {
    const service = serviceWith(repo);

    const room = await service.updateLinks(ROOM.id, {
      confluenceUrl: 'https://confluence.example.com/page',
    });

    expect(room.confluenceUrl).toBe('https://confluence.example.com/page');
  });

  it('правка поверх чужой отклоняется: версия ссылок устарела', async () => {
    const updateRoomLinks = vi.fn(async () => ROOM);
    const service = serviceWith({
      ...repo,
      // Пока участник печатал, ссылки уже поменяли
      lockRoom: async () => ({ ...ROOM, linksVersion: 5 }),
      updateRoomLinks,
    });

    await expect(
      service.updateLinks(ROOM.id, { jiraUrl: 'https://jira.example.com/TASK-9', version: 4 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(updateRoomLinks).not.toHaveBeenCalled();
  });

  it('версия null означает «версию не проверять», а не вечный конфликт', async () => {
    const updateRoomLinks = vi.fn(async (_id: string, links: object) => ({ ...ROOM, ...links }));
    const service = serviceWith({ ...repo, updateRoomLinks });

    await service.updateLinks(ROOM.id, {
      jiraUrl: 'https://jira.example.com/TASK-1',
      version: null,
    });

    expect(updateRoomLinks).toHaveBeenCalledWith(
      ROOM.id,
      { jiraUrl: 'https://jira.example.com/TASK-1' },
      undefined,
    );
  });

  it('пустая правка не поднимает версию: чужие правки не должны отбиваться', async () => {
    const updateRoomLinks = vi.fn(async () => ROOM);
    const service = serviceWith({ ...repo, updateRoomLinks });

    const room = await service.updateLinks(ROOM.id, {});

    expect(room.linksVersion).toBe(ROOM.linksVersion);
    expect(updateRoomLinks).not.toHaveBeenCalled();
  });

  it('правка с актуальной версией доходит до базы вместе с ней', async () => {
    const updateRoomLinks = vi.fn(async (_id: string, links: object) => ({ ...ROOM, ...links }));
    const service = serviceWith({ ...repo, updateRoomLinks });

    await service.updateLinks(ROOM.id, {
      jiraUrl: 'https://jira.example.com/TASK-9',
      version: ROOM.linksVersion,
    });

    expect(updateRoomLinks).toHaveBeenCalledWith(
      ROOM.id,
      { jiraUrl: 'https://jira.example.com/TASK-9' },
      ROOM.linksVersion,
    );
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

describe('RoomsService: архивная комната блокирует действия за столом', () => {
  it('голосовать в архивной комнате нельзя', async () => {
    const archivedRoom: Room = { ...ROOM, archivedAt: new Date().toISOString() };
    const service = serviceWith({ lockRoom: async () => archivedRoom });

    await expect(service.submitVote(ROOM.id, VOTER, { value: 3 })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

/**
 * getState заводит свой RoomsRepository прямо внутри транзакции — раньше это
 * значило, что метод нельзя было проверить без реальной БД. Фабрика в
 * конструкторе (7.30) позволяет подменить репозиторий заглушкой напрямую,
 * без глобального vi.spyOn(RoomsRepository.prototype, ...) и без БД.
 */
describe('RoomsService.getState (7.30)', () => {
  it('строит снимок стола из данных репозитория без обращения к БД', async () => {
    const db = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    } as unknown as Db;

    const fakeRepo: Partial<RoomsRepository> = {
      findRoom: vi.fn(async () => ROOM),
      findCurrentRound: vi.fn(async () => ROUND),
      listVotes: vi.fn(async () => [{ participantId: VOTER.participantId, name: null, value: 5 }]),
    };

    const service = new RoomsService(
      db,
      new RoomsRepository(db),
      new TeamsRepository(db),
      {} as UsersRepository,
      new GuestSessions(GUEST_SECRET, 'guest'),
      () => fakeRepo as RoomsRepository,
    );

    const state = await service.getState(ROOM.id, [VOTER, MASTER]);

    expect(fakeRepo.findRoom).toHaveBeenCalledWith(ROOM.id);
    expect(state.room).toEqual(ROOM);
    expect(state.participants.find((p) => p.participantId === VOTER.participantId)?.hasVoted).toBe(
      true,
    );
    expect(state.participants.find((p) => p.participantId === MASTER.participantId)?.hasVoted).toBe(
      false,
    );
    // Раунд ещё голосуется — оценки не раскрываются
    expect(state.result).toBeNull();
  });
});
