import type {
  Room,
  BoardSummary,
  Team,
  TeamMember,
  TeamMemberProfile,
  TeamRole,
  TeamWithRole,
} from '@estimate/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  changeTeamMemberRole,
  createTeam,
  deleteTeam,
  getTeam,
  getTeamMember,
  joinInvite,
  listTeamBoards,
  listTeamRooms,
  listTeams,
  previewInvite,
  removeTeamMember,
  renameTeam,
  rotateTeamInvite,
  type TeamOverviewResponse,
} from '../src/features/teams/api/teams-api';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const team: Team = { id: 't1', name: 'Команда А', createdAt: '2026-07-24T00:00:00.000Z' };
const teamWithRole: TeamWithRole = { ...team, role: 'admin', memberCount: 1 };
const member: TeamMember = {
  userId: 'u1',
  name: 'Иван',
  avatarUrl: null,
  role: 'admin',
  joinedAt: '2026-07-24T00:00:00.000Z',
};

describe('API команд', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listTeams возвращает список команд', async () => {
    fetchMock.mockResolvedValue(json(200, { teams: [teamWithRole] }));
    const res = await listTeams();
    expect(res).toEqual([teamWithRole]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams');
  });

  it('createTeam отправляет имя и возвращает команду', async () => {
    fetchMock.mockResolvedValue(json(201, { team: teamWithRole }));
    const res = await createTeam('Команда Б');
    expect(res).toEqual(teamWithRole);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Команда Б' });
  });

  it('getTeam нормализует отсутствующий inviteCode в null (id кодируется)', async () => {
    fetchMock.mockResolvedValue(json(200, { team, role: 'member', members: [member] }));
    const res: TeamOverviewResponse = await getTeam('a/b');
    expect(res).toEqual({ team, role: 'member', members: [member], inviteCode: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/a%2Fb');
  });

  it('getTeam сохраняет inviteCode для админа', async () => {
    fetchMock.mockResolvedValue(
      json(200, { team, role: 'admin', members: [member], inviteCode: 'abcdef' }),
    );
    const res = await getTeam('t1');
    expect(res.inviteCode).toBe('abcdef');
  });

  it('renameTeam отправляет имя (id кодируется)', async () => {
    fetchMock.mockResolvedValue(json(200, { team }));
    const res = await renameTeam('a/b', 'Новое имя');
    expect(res).toEqual(team);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/teams/a%2Fb');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Новое имя' });
  });

  it('deleteTeam отправляет DELETE (id кодируется)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteTeam('a/b');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/teams/a%2Fb');
    expect(init.method).toBe('DELETE');
  });

  it('rotateTeamInvite возвращает новый код (id кодируется)', async () => {
    fetchMock.mockResolvedValue(json(200, { inviteCode: 'new456' }));
    const code = await rotateTeamInvite('a/b');
    expect(code).toBe('new456');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/a%2Fb/invite/rotate');
  });

  it('previewInvite возвращает команду по коду (код кодируется)', async () => {
    fetchMock.mockResolvedValue(json(200, { team: { id: 't1', name: 'Команда А' } }));
    const res = await previewInvite('a/b');
    expect(res).toEqual({ id: 't1', name: 'Команда А' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/invites/a%2Fb');
  });

  it('joinInvite отправляет POST и возвращает команду с ролью (код кодируется)', async () => {
    fetchMock.mockResolvedValue(json(200, { team, role: 'member' as TeamRole }));
    const res = await joinInvite('a/b');
    expect(res).toEqual({ team, role: 'member' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/invites/a%2Fb/join');
    expect(init.method).toBe('POST');
  });

  it('changeTeamMemberRole отправляет PATCH (id и userId кодируются)', async () => {
    fetchMock.mockResolvedValue(
      json(200, { member: { userId: 'u/2', role: 'admin' }, actorRole: 'admin' }),
    );
    const res = await changeTeamMemberRole('a/b', 'u/2', 'admin');
    expect(res).toEqual({ member: { userId: 'u/2', role: 'admin' }, actorRole: 'admin' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/teams/a%2Fb/members/u%2F2');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ role: 'admin' });
  });

  it('removeTeamMember отправляет DELETE (id и userId кодируются)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await removeTeamMember('a/b', 'u/2');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/teams/a%2Fb/members/u%2F2');
    expect(init.method).toBe('DELETE');
  });

  it('getTeamMember возвращает профиль участника (id и userId кодируются)', async () => {
    const profile: TeamMemberProfile = {
      ...member,
      provider: 'google',
      jobTitle: 'Dev',
    };
    fetchMock.mockResolvedValue(json(200, { member: profile }));
    const res = await getTeamMember('a/b', 'u/2');
    expect(res).toEqual(profile);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/a%2Fb/members/u%2F2');
  });

  it('listTeamRooms возвращает комнаты без archived по умолчанию (id кодируется)', async () => {
    const r: Room = {
      id: 'r1',
      teamId: 't1',
      creatorId: 'u1',
      name: 'Комната',
      status: 'active',
      revision: 0,
      createdAt: '2026-07-25T00:00:00.000Z',
      archivedAt: null,
      jiraUrl: null,
      confluenceUrl: null,
      linksVersion: 1,
    };
    fetchMock.mockResolvedValue(json(200, { rooms: [r] }));
    const res = await listTeamRooms('a/b');
    expect(res).toEqual([r]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/a%2Fb/rooms');
  });

  it('listTeamRooms добавляет ?archived=true по требованию', async () => {
    fetchMock.mockResolvedValue(json(200, { rooms: [] }));
    await listTeamRooms('t1', true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/t1/rooms?archived=true');
  });

  it('listTeamBoards возвращает доски без archived по умолчанию (id кодируется)', async () => {
    const b: BoardSummary = {
      id: 'b1',
      teamId: 't1',
      ownerId: 'u1',
      title: 'Доска',
      status: 'active',
      revision: 0,
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:00.000Z',
      shareRole: null,
      itemCount: 0,
    };
    fetchMock.mockResolvedValue(json(200, { boards: [b] }));
    const res = await listTeamBoards('a/b');
    expect(res).toEqual([b]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/a%2Fb/boards');
  });

  it('listTeamBoards добавляет ?archived=true по требованию', async () => {
    fetchMock.mockResolvedValue(json(200, { boards: [] }));
    await listTeamBoards('t1', true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/t1/boards?archived=true');
  });
});
