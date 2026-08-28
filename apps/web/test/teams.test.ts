import type { TeamMember, TeamWithRole } from '@estimate/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api';
import { useTeamsStore } from '../src/stores/teams';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const teamA: TeamWithRole = {
  id: 't1',
  name: 'Команда А',
  createdAt: '2026-07-24T00:00:00.000Z',
  role: 'admin',
  memberCount: 1,
};

const member: TeamMember = {
  userId: 'u1',
  name: 'Иван',
  email: 'ivan@example.com',
  avatarUrl: null,
  role: 'admin',
  joinedAt: '2026-07-24T00:00:00.000Z',
};

describe('стор команд', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('загружает список команд', async () => {
    fetchMock.mockResolvedValue(json(200, { teams: [teamA] }));
    const teams = useTeamsStore();

    await teams.loadList();

    expect(teams.list).toEqual([teamA]);
  });

  it('добавляет созданную команду в начало списка', async () => {
    const teamB: TeamWithRole = { ...teamA, id: 't2', name: 'Команда Б' };
    fetchMock.mockResolvedValueOnce(json(200, { teams: [teamA] }));
    const teams = useTeamsStore();
    await teams.loadList();

    fetchMock.mockResolvedValueOnce(json(201, { team: teamB }));
    const created = await teams.create('Команда Б');

    expect(created).toEqual(teamB);
    expect(teams.list.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('карточка команды: отсутствие кода приглашения превращается в null', async () => {
    fetchMock.mockResolvedValue(json(200, { team: teamA, role: 'member', members: [member] }));
    const teams = useTeamsStore();

    const overview = await teams.loadTeam('t1');

    expect(overview.inviteCode).toBeNull();
    expect(overview.members).toEqual([member]);
    expect(teams.current?.team.id).toBe('t1');
  });

  it('карточка команды: код приглашения сохраняется для админа', async () => {
    fetchMock.mockResolvedValue(
      json(200, { team: teamA, role: 'admin', members: [member], inviteCode: 'abcdef' }),
    );
    const teams = useTeamsStore();

    const overview = await teams.loadTeam('t1');

    expect(overview.inviteCode).toBe('abcdef');
  });

  it('перевыпуск кода обновляет открытую карточку', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { team: teamA, role: 'admin', members: [member], inviteCode: 'old123' }),
    );
    const teams = useTeamsStore();
    await teams.loadTeam('t1');

    fetchMock.mockResolvedValueOnce(json(200, { inviteCode: 'new456' }));
    const code = await teams.rotateInvite('t1');

    expect(code).toBe('new456');
    expect(teams.current?.inviteCode).toBe('new456');
  });

  it('предпросмотр приглашения возвращает команду', async () => {
    fetchMock.mockResolvedValue(json(200, { team: { id: 't1', name: 'Команда А' } }));
    const teams = useTeamsStore();

    const team = await teams.previewInvite('abcdef');

    expect(team).toEqual({ id: 't1', name: 'Команда А' });
  });

  it('вступление по коду возвращает команду и роль', async () => {
    fetchMock.mockResolvedValue(json(200, { team: teamA, role: 'member' }));
    const teams = useTeamsStore();

    const res = await teams.joinByInvite('abcdef');

    expect(res.role).toBe('member');
    expect(res.team.id).toBe('t1');
  });

  it('пробрасывает ApiError с кодом 404 по неверному приглашению', async () => {
    fetchMock.mockResolvedValue(json(404, { error: 'not_found', message: 'нет' }));
    const teams = useTeamsStore();

    await expect(teams.previewInvite('zzz')).rejects.toBeInstanceOf(ApiError);
  });

  const other: TeamMember = {
    userId: 'u2',
    name: 'Пётр',
    email: 'petr@example.com',
    avatarUrl: null,
    role: 'member',
    joinedAt: '2026-07-24T00:00:00.000Z',
  };

  it('смена роли участника обновляет состав', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { team: teamA, role: 'admin', members: [member, other] }),
    );
    const teams = useTeamsStore();
    await teams.loadTeam('t1');

    fetchMock.mockResolvedValueOnce(
      json(200, { member: { userId: 'u2', role: 'admin' }, actorRole: 'admin' }),
    );
    await teams.changeMemberRole('t1', 'u2', 'admin');

    expect(teams.current?.members.find((m) => m.userId === 'u2')?.role).toBe('admin');
    expect(teams.current?.role).toBe('admin');
  });

  it('смена своей роли обновляет роль текущей карточки', async () => {
    const secondAdmin: TeamMember = { ...other, userId: 'u2', role: 'admin' };
    fetchMock.mockResolvedValueOnce(
      json(200, { team: teamA, role: 'admin', members: [member, secondAdmin] }),
    );
    const teams = useTeamsStore();
    await teams.loadTeam('t1');

    // Администратор понижает сам себя (u1) — в команде остался ещё один админ (u2)
    fetchMock.mockResolvedValueOnce(
      json(200, { member: { userId: 'u1', role: 'member' }, actorRole: 'member' }),
    );
    await teams.changeMemberRole('t1', 'u1', 'member');

    expect(teams.current?.members.find((m) => m.userId === 'u1')?.role).toBe('member');
    expect(teams.current?.role).toBe('member');
  });

  it('исключение участника убирает его из состава', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { team: teamA, role: 'admin', members: [member, other] }),
    );
    const teams = useTeamsStore();
    await teams.loadTeam('t1');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await teams.removeMember('t1', 'u2');

    expect(teams.current?.members.map((m) => m.userId)).toEqual(['u1']);
  });

  it('переименование обновляет карточку и список', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { teams: [teamA] }));
    const teams = useTeamsStore();
    await teams.loadList();
    fetchMock.mockResolvedValueOnce(json(200, { team: teamA, role: 'admin', members: [member] }));
    await teams.loadTeam('t1');

    const renamed = { ...teamA, name: 'Новое имя' };
    fetchMock.mockResolvedValueOnce(json(200, { team: renamed }));
    await teams.rename('t1', 'Новое имя');

    expect(teams.current?.team.name).toBe('Новое имя');
    expect(teams.list.find((t) => t.id === 't1')?.name).toBe('Новое имя');
  });

  it('удаление убирает команду из списка и очищает карточку', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { teams: [teamA] }));
    const teams = useTeamsStore();
    await teams.loadList();
    fetchMock.mockResolvedValueOnce(json(200, { team: teamA, role: 'admin', members: [member] }));
    await teams.loadTeam('t1');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await teams.remove('t1');

    expect(teams.list).toEqual([]);
    expect(teams.current).toBeNull();
  });
});
