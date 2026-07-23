/**
 * Юнит-тесты правил команд без БД: репозиторий подменён заглушкой.
 * Проверяем то, что на живой базе воспроизводится только гонкой.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Db } from '../src/db';
import { NotFoundError, UnauthorizedError, ValidationError } from '../src/errors';
import { TeamsRepository, TeamsService } from '../src/teams';

const TEAM = { id: 'team-1', name: 'Команда', createdAt: new Date().toISOString() };

/** Ошибка pg в том виде, в каком её оборачивает Drizzle */
function foreignKeyViolation(constraint: string): Error {
  return Object.assign(new Error('Failed query'), {
    cause: { code: '23503', constraint },
  });
}

function serviceWith(repository: Partial<TeamsRepository>): TeamsService {
  return new TeamsService({} as Db, repository as TeamsRepository);
}

describe('TeamsService.joinByInvite', () => {
  it('команда, удалённая между чтением и вставкой, даёт 404, а не 500', async () => {
    const service = serviceWith({
      findTeamByInviteCode: vi.fn(async () => TEAM),
      insertMemberIfAbsent: vi.fn(async () => {
        throw foreignKeyViolation('team_members_team_id_teams_id_fk');
      }),
    });

    await expect(service.joinByInvite('user-1', 'code12345678')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('удалённый аккаунт получает 401, а не 500', async () => {
    const service = serviceWith({
      findTeamByInviteCode: vi.fn(async () => TEAM),
      insertMemberIfAbsent: vi.fn(async () => {
        throw foreignKeyViolation('team_members_user_id_users_id_fk');
      }),
    });

    await expect(service.joinByInvite('user-1', 'code12345678')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('прочие ошибки БД не маскируются', async () => {
    const service = serviceWith({
      findTeamByInviteCode: vi.fn(async () => TEAM),
      insertMemberIfAbsent: vi.fn(async () => {
        throw new Error('соединение потеряно');
      }),
    });

    await expect(service.joinByInvite('user-1', 'code12345678')).rejects.toThrow(
      /соединение потеряно/,
    );
  });

  it('неизвестный код приглашения даёт 404', async () => {
    const service = serviceWith({ findTeamByInviteCode: vi.fn(async () => null) });

    await expect(service.joinByInvite('user-1', 'code12345678')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('TeamsService: название команды', () => {
  it('пустое название и одни пробелы отклоняются', async () => {
    const service = serviceWith({});

    await expect(service.create('user-1', '   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('слишком длинное название отклоняется', async () => {
    const service = serviceWith({});

    await expect(service.create('user-1', 'я'.repeat(81))).rejects.toBeInstanceOf(ValidationError);
  });

  it('название из 80 символов с пробелами по краям проходит', async () => {
    const insertTeam = vi.fn(async (name: string) => ({ ...TEAM, name, inviteCode: 'code' }));
    const service = new TeamsService(
      {
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
      } as unknown as Db,
      {} as TeamsRepository,
    );
    vi.spyOn(TeamsRepository.prototype, 'insertTeam').mockImplementation(insertTeam);
    vi.spyOn(TeamsRepository.prototype, 'insertMember').mockResolvedValue(undefined);

    const name = 'я'.repeat(80);
    const team = await service.create('user-1', `  ${name}  `);

    expect(team.name).toBe(name);
    expect(team.role).toBe('owner');
    vi.restoreAllMocks();
  });
});
