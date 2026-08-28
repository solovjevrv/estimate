/**
 * Комнаты целиком: REST на реальной PostgreSQL и полный игровой цикл
 * по WebSocket с двумя клиентами. Без DATABASE_URL — пропускаются.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import type {
  AuthUser,
  JoinRoomResult,
  Room,
  Round,
  RoomState,
  RoundResult,
  WsAck,
} from '@estimate/shared';
import { WS_EVENTS, WS_SERVER_EVENTS } from '@estimate/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Socket, io as createClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, TokenService, UsersRepository } from '../src/auth';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';
import { ConflictError } from '../src/errors';
import type { ParticipantIdentity } from '../src/rooms';
import { RoomsRepository, RoomsService } from '../src/rooms';
import { SocketGateway } from '../src/socket';
import { TeamsRepository, TeamsService } from '../src/teams';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const authConfig: AuthConfig = {
  jwtSecret: 'секрет-для-тестов-длиннее-тридцати-двух-символов',
  guestSecret: 'гостевой-секрет-для-тестов-длиннее-тридцати-двух',
  publicOrigin: 'http://localhost:3000',
  webOrigin: 'http://localhost:5173',
  cookieSecure: false,
  providers: {},
};

const ANSWER_TIMEOUT_MS = 3_000;

describeDb('комнаты', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let app: FastifyInstance;
  let port: number;
  let teamsService: TeamsService;
  const userIds: string[] = [];
  const teamIds: string[] = [];
  const roomIds: string[] = [];
  const clients: Socket[] = [];

  function as(user: AuthUser): { cookie: string } {
    return {
      cookie: `${ACCESS_COOKIE}=${new TokenService(app.jwt, false).issue(user.id, randomUUID()).access}`,
    };
  }

  async function newUser(label: string): Promise<AuthUser> {
    const id = randomUUID();
    const user = await new UsersRepository(db).upsertFromOAuth('google', {
      providerId: `${label}-${id}`,
      email: `${label}-${id}@example.com`,
      name: `Пользователь ${label}`,
      avatarUrl: null,
    });
    userIds.push(user.id);
    return user;
  }

  async function newRoom(owner: AuthUser, name = 'Оценка спринта'): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: as(owner),
      payload: { name },
    });
    const { room } = res.json() as { room: { id: string } };
    roomIds.push(room.id);
    return room.id;
  }

  /** Клиент сокета: с кукой пользователя или без неё — тогда это гость */
  function connect(user?: AuthUser): Socket {
    const client = createClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      extraHeaders: user ? as(user) : {},
    });
    clients.push(client);
    return client;
  }

  /** Отправляет событие и ждёт подтверждение сервера */
  function emit<T>(client: Socket, event: string, payload?: unknown): Promise<WsAck<T>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`нет ответа на ${event}`)),
        ANSWER_TIMEOUT_MS,
      );
      const done = (ack: WsAck<T>): void => {
        clearTimeout(timer);
        resolve(ack);
      };
      if (payload === undefined) {
        client.emit(event, done);
      } else {
        client.emit(event, payload, done);
      }
    });
  }

  /** Ждёт ближайшую рассылку состояния комнаты */
  function nextState(client: Socket): Promise<RoomState> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('состояние не пришло')), ANSWER_TIMEOUT_MS);
      client.once(WS_SERVER_EVENTS.ROOM_STATE, (state: RoomState) => {
        clearTimeout(timer);
        resolve(state);
      });
    });
  }

  async function join(
    client: Socket,
    roomId: string,
    extra: { guestName?: string; guestToken?: string } = {},
  ): Promise<JoinRoomResult> {
    const ack = await emit<JoinRoomResult>(client, WS_EVENTS.JOIN_ROOM, { roomId, ...extra });
    if (!ack.ok) {
      throw new Error(`не удалось войти в комнату: ${ack.message}`);
    }
    return ack.data;
  }

  async function joinRoom(client: Socket, roomId: string, guestName?: string): Promise<RoomState> {
    return (await join(client, roomId, guestName ? { guestName } : {})).state;
  }

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl as string));
    teamsService = TeamsService.forDatabase(db);
    // Файл гоняет десятки запросов на комнаты с одного IP — реальный лимит (7.34)
    // тут же и словил бы этот тестовый трафик, поэтому он тут завышен
    app = buildApp({
      db,
      auth: authConfig,
      roomsRateLimit: { max: 10_000, timeWindow: '1 minute' },
    });
    const roomsService = RoomsService.forDatabase(db, authConfig.guestSecret);
    new SocketGateway(roomsService, { corsOrigin: '*' }).attach(app);
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    try {
      for (const client of clients) {
        client.close();
      }
      await app?.close();
      if (roomIds.length > 0) {
        await db.delete(schema.rooms).where(inArray(schema.rooms.id, roomIds));
      }
      if (teamIds.length > 0) {
        await db.delete(schema.teams).where(inArray(schema.teams.id, teamIds));
      }
      if (userIds.length > 0) {
        await db.delete(schema.users).where(inArray(schema.users.id, userIds));
      }
    } finally {
      await pool?.end();
    }
  });

  describe('REST', () => {
    it('создатель комнаты становится скрам-мастером, комната открыта по ссылке', async () => {
      const owner = await newUser('room-owner');

      const created = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: as(owner),
        payload: { name: '  Оценка бэклога  ' },
      });

      expect(created.statusCode).toBe(201);
      const { room } = created.json() as { room: { id: string; name: string; creatorId: string } };
      roomIds.push(room.id);
      expect(room.name).toBe('Оценка бэклога');
      expect(room.creatorId).toBe(owner.id);

      // Без входа комната всё равно видна: гости заходят по прямой ссылке
      const anonymous = await app.inject({ method: 'GET', url: `/api/rooms/${room.id}` });
      expect(anonymous.statusCode).toBe(200);
    });

    it('комнату команды заводит администратор, но не рядовой участник', async () => {
      const owner = await newUser('team-room-owner');
      const member = await newUser('team-room-member');
      const team = await teamsService.create(owner.id, `Команда ${randomUUID().slice(0, 8)}`);
      teamIds.push(team.id);
      await new TeamsRepository(db).insertMemberIfAbsent(team.id, member.id, 'member');

      const byMember = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: as(member),
        payload: { name: 'Комната команды', teamId: team.id },
      });
      const byOwner = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: as(owner),
        payload: { name: 'Комната команды', teamId: team.id },
      });

      expect(byMember.statusCode).toBe(403);
      expect(byOwner.statusCode).toBe(201);
      roomIds.push((byOwner.json() as { room: { id: string } }).room.id);

      const list = await app.inject({
        method: 'GET',
        url: `/api/teams/${team.id}/rooms`,
        headers: as(member),
      });
      expect((list.json() as { rooms: unknown[] }).rooms).toHaveLength(1);
    });

    it('список своих комнат показывает и личные, и командные, но только созданные мной', async () => {
      const owner = await newUser('mine-owner');
      const stranger = await newUser('mine-stranger');
      const team = await teamsService.create(owner.id, `Команда ${randomUUID().slice(0, 8)}`);
      teamIds.push(team.id);
      await new TeamsRepository(db).insertMemberIfAbsent(team.id, stranger.id, 'admin');
      const personal = await newRoom(owner, 'Личная комната');
      const teamRoom = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: as(owner),
        payload: { name: 'Командная комната', teamId: team.id },
      });
      const teamRoomId = (teamRoom.json() as { room: { id: string } }).room.id;
      roomIds.push(teamRoomId);
      // Чужая комната той же команды не должна попасть в чужой список «моих»
      const strangerRoom = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: as(stranger),
        payload: { name: 'Комната участника', teamId: team.id },
      });
      roomIds.push((strangerRoom.json() as { room: { id: string } }).room.id);

      const res = await app.inject({ method: 'GET', url: '/api/rooms', headers: as(owner) });

      const rooms = (res.json() as { rooms: Array<{ id: string }> }).rooms;
      expect(rooms.map((room) => room.id).sort()).toEqual([personal, teamRoomId].sort());
    });

    it('несуществующая комната даёт 404', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/rooms/${randomUUID()}` });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('история раундов и статистика — 5.7/3.6', () => {
    let service: RoomsService;

    function asMaster(user: AuthUser): ParticipantIdentity {
      return {
        participantId: user.id,
        userId: user.id,
        name: user.name,
        avatarUrl: null,
        isGuest: false,
        role: 'scrum_master',
      };
    }

    beforeAll(() => {
      service = RoomsService.forDatabase(db, authConfig.guestSecret);
    });

    it('история отдаёт вскрытые раунды с итогами, от последнего к первому', async () => {
      const owner = await newUser('history-owner');
      const roomId = await newRoom(owner);
      const master = asMaster(owner);

      await service.startNewRound(roomId, master, { deckType: 'fibonacci' });
      await service.submitVote(roomId, master, { value: 3 });
      await service.revealCards(roomId, master);
      await service.startNewRound(roomId, master, { deckType: 'fibonacci' });
      await service.submitVote(roomId, master, { value: 8 });
      await service.revealCards(roomId, master);
      // Текущий раунд не вскрыт — в историю попадать не должен
      await service.startNewRound(roomId, master, { deckType: 'fibonacci' });

      // Без входа: история открыта так же, как и сама комната
      const res = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/rounds` });

      expect(res.statusCode).toBe(200);
      const { rounds } = res.json() as {
        rounds: Array<{ round: Round; result: RoundResult }>;
      };
      expect(rounds).toHaveLength(2);
      expect(rounds.map((entry) => entry.round.seq)).toEqual([2, 1]);
      expect(rounds[0]?.round.average).toBe(8);
      expect(rounds[0]?.result.min).toBe(8);
      expect(rounds[0]?.result.max).toBe(8);
      expect(rounds[1]?.round.average).toBe(3);
    });

    it('раунд без единого голоса (голос ушёл каскадом вместе с аккаунтом) пропускается в истории', async () => {
      const owner = await newUser('history-orphan-owner');
      const roomId = await newRoom(owner);
      const master = asMaster(owner);
      const voter = await newUser('history-orphan-voter');

      await service.startNewRound(roomId, master, { deckType: 'fibonacci' });
      await service.submitVote(roomId, { ...asMaster(voter), role: 'voter' }, { value: 5 });
      await service.revealCards(roomId, master);
      // Единственный проголосовавший исчез — его голос ушёл каскадом вместе с ним
      await db.delete(schema.users).where(eq(schema.users.id, voter.id));
      userIds.splice(userIds.indexOf(voter.id), 1);

      const res = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/rounds` });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { rounds: unknown[] }).rounds).toHaveLength(0);
    });

    it('история несуществующей комнаты — 404', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/rooms/${randomUUID()}/rounds` });

      expect(res.statusCode).toBe(404);
    });

    it('статистика считает вскрытые раунды по всем комнатам создателя, архивным и активным вместе', async () => {
      const owner = await newUser('stats-owner');
      const stranger = await newUser('stats-stranger');
      const master = asMaster(owner);

      const activeRoomId = await newRoom(owner, 'Активная комната для статистики');
      await service.startNewRound(activeRoomId, master, { deckType: 'fibonacci' });
      await service.submitVote(activeRoomId, master, { value: 5 });
      await service.revealCards(activeRoomId, master);

      const archivedRoomId = await newRoom(owner, 'Архивная комната для статистики');
      await service.startNewRound(archivedRoomId, master, { deckType: 'fibonacci' });
      await service.submitVote(archivedRoomId, master, { value: 13 });
      await service.revealCards(archivedRoomId, master);
      await service.archiveRoom(owner.id, archivedRoomId);

      // Чужая комната не должна попасть в статистику владельца
      const strangerRoomId = await newRoom(stranger, 'Чужая комната');
      const strangerMaster = asMaster(stranger);
      await service.startNewRound(strangerRoomId, strangerMaster, { deckType: 'fibonacci' });
      await service.submitVote(strangerRoomId, strangerMaster, { value: 21 });
      await service.revealCards(strangerRoomId, strangerMaster);

      const res = await app.inject({
        method: 'GET',
        url: '/api/rooms/stats',
        headers: as(owner),
      });

      expect(res.statusCode).toBe(200);
      const { stats } = res.json() as {
        stats: { roundsPlayed: number; tasksEstimated: number; avgRoundDurationSec: number | null };
      };
      expect(stats.roundsPlayed).toBe(2);
      expect(stats.tasksEstimated).toBe(2);
      expect(stats.avgRoundDurationSec).not.toBeNull();
      expect(stats.avgRoundDurationSec).toBeGreaterThanOrEqual(0);
    });

    it('статистика без входа — 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/rooms/stats' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('архивация и удаление', () => {
    it('архивировать может только скрам-мастер, комната пропадает из списка', async () => {
      const owner = await newUser('archive-owner');
      const stranger = await newUser('archive-stranger');
      const roomId = await newRoom(owner, 'Комната к архивации');

      const byStranger = await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/archive`,
        headers: as(stranger),
      });
      expect(byStranger.statusCode).toBe(403);

      const byOwner = await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/archive`,
        headers: as(owner),
      });
      expect(byOwner.statusCode).toBe(200);
      expect(byOwner.json()).toMatchObject({ room: { archivedAt: expect.any(String) } });

      // Повторная архивация — конфликт
      const again = await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/archive`,
        headers: as(owner),
      });
      expect(again.statusCode).toBe(409);

      // Из обычного списка комната пропала, но видна в архиве
      const mine = await app.inject({ method: 'GET', url: '/api/rooms', headers: as(owner) });
      expect((mine.json() as { rooms: Array<{ id: string }> }).rooms).not.toContainEqual(
        expect.objectContaining({ id: roomId }),
      );
      const archived = await app.inject({
        method: 'GET',
        url: '/api/rooms?archived=true',
        headers: as(owner),
      });
      expect((archived.json() as { rooms: Array<{ id: string }> }).rooms).toContainEqual(
        expect.objectContaining({ id: roomId }),
      );

      // По прямой ссылке комната всё ещё доступна — только для чтения
      const direct = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}` });
      expect(direct.statusCode).toBe(200);
    });

    it('удалить навсегда можно только уже заархивированную комнату', async () => {
      const owner = await newUser('delete-owner');
      const roomId = await newRoom(owner, 'Комната к удалению');

      const tooEarly = await app.inject({
        method: 'DELETE',
        url: `/api/rooms/${roomId}`,
        headers: as(owner),
      });
      expect(tooEarly.statusCode).toBe(409);

      await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/archive`, headers: as(owner) });
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/rooms/${roomId}`,
        headers: as(owner),
      });
      expect(deleted.statusCode).toBe(204);

      const gone = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}` });
      expect(gone.statusCode).toBe(404);
      // Комнату уже удалили сама — afterAll не должен пытаться удалить её ещё раз
      roomIds.splice(roomIds.indexOf(roomId), 1);
    });

    it('архив команды виден только владельцу и администратору', async () => {
      const owner = await newUser('team-archive-owner');
      const member = await newUser('team-archive-member');
      const team = await teamsService.create(owner.id, `Команда ${randomUUID().slice(0, 8)}`);
      teamIds.push(team.id);
      await new TeamsRepository(db).insertMemberIfAbsent(team.id, member.id, 'member');
      const created = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: as(owner),
        payload: { name: 'Комната команды', teamId: team.id },
      });
      const roomId = (created.json() as { room: { id: string } }).room.id;
      roomIds.push(roomId);
      await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/archive`,
        headers: as(owner),
      });

      const byMember = await app.inject({
        method: 'GET',
        url: `/api/teams/${team.id}/rooms?archived=true`,
        headers: as(member),
      });
      expect(byMember.statusCode).toBe(403);

      const byOwner = await app.inject({
        method: 'GET',
        url: `/api/teams/${team.id}/rooms?archived=true`,
        headers: as(owner),
      });
      expect(byOwner.statusCode).toBe(200);
      expect((byOwner.json() as { rooms: Array<{ id: string }> }).rooms).toContainEqual(
        expect.objectContaining({ id: roomId }),
      );
    });

    it('в архивной комнате нельзя начать раунд', async () => {
      const owner = await newUser('archived-round-owner');
      const roomId = await newRoom(owner, 'Комната в архиве');
      await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/archive`, headers: as(owner) });
      const master = connect(owner);
      await joinRoom(master, roomId);

      const ack = await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });

      expect(ack).toMatchObject({ ok: false, error: 'conflict' });
    });
  });

  describe('переименование — 7.20', () => {
    it('переименовать может только скрам-мастер (создатель), чужой участник получает 403', async () => {
      const owner = await newUser('rename-owner');
      const stranger = await newUser('rename-stranger');
      const roomId = await newRoom(owner, 'Старое название');

      const byStranger = await app.inject({
        method: 'PATCH',
        url: `/api/rooms/${roomId}`,
        headers: as(stranger),
        payload: { name: 'Чужое переименование' },
      });
      expect(byStranger.statusCode).toBe(403);

      const byOwner = await app.inject({
        method: 'PATCH',
        url: `/api/rooms/${roomId}`,
        headers: as(owner),
        payload: { name: 'Новое название' },
      });
      expect(byOwner.statusCode).toBe(200);
      expect(byOwner.json()).toMatchObject({ room: { name: 'Новое название' } });

      const direct = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}` });
      expect(direct.json()).toMatchObject({ room: { name: 'Новое название' } });
    });

    it('администратор команды может переименовать командную комнату, обычный участник — нет', async () => {
      const owner = await newUser('rename-team-owner');
      const admin = await newUser('rename-team-admin');
      const member = await newUser('rename-team-member');
      const team = await teamsService.create(owner.id, `Команда ${randomUUID().slice(0, 8)}`);
      teamIds.push(team.id);
      await new TeamsRepository(db).insertMemberIfAbsent(team.id, admin.id, 'admin');
      await new TeamsRepository(db).insertMemberIfAbsent(team.id, member.id, 'member');
      const created = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: as(owner),
        payload: { name: 'Комната команды', teamId: team.id },
      });
      const roomId = (created.json() as { room: { id: string } }).room.id;
      roomIds.push(roomId);

      const byMember = await app.inject({
        method: 'PATCH',
        url: `/api/rooms/${roomId}`,
        headers: as(member),
        payload: { name: 'Переименовано участником' },
      });
      expect(byMember.statusCode).toBe(403);

      const byAdmin = await app.inject({
        method: 'PATCH',
        url: `/api/rooms/${roomId}`,
        headers: as(admin),
        payload: { name: 'Переименовано администратором' },
      });
      expect(byAdmin.statusCode).toBe(200);
    });

    it('пустое и слишком длинное название отклоняются валидацией, архивную комнату переименовать можно', async () => {
      const owner = await newUser('rename-validation-owner');
      const roomId = await newRoom(owner, 'Комната для валидации');

      const empty = await app.inject({
        method: 'PATCH',
        url: `/api/rooms/${roomId}`,
        headers: as(owner),
        payload: { name: '   ' },
      });
      expect(empty.statusCode).toBe(400);

      const tooLong = await app.inject({
        method: 'PATCH',
        url: `/api/rooms/${roomId}`,
        headers: as(owner),
        payload: { name: 'а'.repeat(200) },
      });
      expect(tooLong.statusCode).toBe(400);

      await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/archive`, headers: as(owner) });
      const renameArchived = await app.inject({
        method: 'PATCH',
        url: `/api/rooms/${roomId}`,
        headers: as(owner),
        payload: { name: 'Переименовано после архивации' },
      });
      expect(renameArchived.statusCode).toBe(200);
    });

    it('несуществующая комната отвечает 404', async () => {
      const owner = await newUser('rename-missing-owner');
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/rooms/${randomUUID()}`,
        headers: as(owner),
        payload: { name: 'Название' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('игровой цикл по WebSocket', () => {
    it('двое голосуют, скрам-мастер вскрывает карты и начинает новый раунд', async () => {
      const owner = await newUser('game-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();

      const masterState = await joinRoom(master, roomId);
      expect(masterState.participants[0]).toMatchObject({ role: 'scrum_master', hasVoted: false });
      expect(masterState.round).toBeNull();

      // Гость садится за стол — остальные видят его сразу
      const masterSeesGuest = nextState(master);
      const guestState = await joinRoom(guest, roomId, 'Гостья Мария');
      expect(guestState.participants).toHaveLength(2);
      expect((await masterSeesGuest).participants).toHaveLength(2);

      // Скрам-мастер открывает раунд
      const guestSeesRound = nextState(guest);
      const started = await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      expect(started.ok).toBe(true);
      const roundState = await guestSeesRound;
      expect(roundState.round).toMatchObject({ seq: 1, deckType: 'fibonacci', status: 'voting' });

      // Голоса: до вскрытия видно только сам факт
      await emit(guest, WS_EVENTS.SUBMIT_VOTE, { value: 3 });
      const afterVotes = nextState(guest);
      await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 8 });
      const voted = await afterVotes;
      expect(voted.participants.every((participant) => participant.hasVoted)).toBe(true);
      expect(voted.result).toBeNull();
      expect(JSON.stringify(voted)).not.toMatch(/"value"/);

      // Голосующему вскрывать нельзя
      const forbidden = await emit(guest, WS_EVENTS.REVEAL_CARDS);
      expect(forbidden).toMatchObject({ ok: false, error: 'forbidden' });

      // Вскрытие: среднее по всем голосам и разброс
      const guestSeesResult = nextState(guest);
      expect((await emit(master, WS_EVENTS.REVEAL_CARDS)).ok).toBe(true);
      const revealed = await guestSeesResult;
      expect(revealed.round?.status).toBe('revealed');
      // Голоса разные — за самое частое значение всего 1 из 2
      expect(revealed.result).toMatchObject({ average: 5.5, min: 3, max: 8, agreement: 50 });
      expect(revealed.result?.votes).toHaveLength(2);

      // Новый раунд обнуляет стол
      const guestSeesNewRound = nextState(guest);
      expect((await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'scale_0_5' })).ok).toBe(
        true,
      );
      const fresh = await guestSeesNewRound;
      expect(fresh.round).toMatchObject({ seq: 2, deckType: 'scale_0_5', status: 'voting' });
      expect(fresh.result).toBeNull();
      expect(fresh.participants.some((participant) => participant.hasVoted)).toBe(false);
    });

    it('после вскрытия карт голос подписан именем, изменённым в профиле (9.2), а не именем от провайдера', async () => {
      const owner = await newUser('reveal-display-name-owner');
      await new UsersRepository(db).updateProfile(owner.id, {
        name: 'Скрам-мастер Псевдоним',
        jobTitle: null,
      });
      const roomId = await newRoom(owner);
      const master = connect(owner);

      await joinRoom(master, roomId);
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 5 });

      const ack = await emit<RoundResult>(master, WS_EVENTS.REVEAL_CARDS);

      expect(ack.ok && ack.data?.votes).toMatchObject([
        { name: 'Скрам-мастер Псевдоним', value: 5 },
      ]);
    });

    it('колода футболочных размеров: среднее не считается, но согласие есть', async () => {
      const owner = await newUser('tshirt-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();

      await joinRoom(master, roomId);
      await joinRoom(guest, roomId, 'Гость');
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'tshirt' });

      // Значение вне колоды маек отклоняется
      const rejected = await emit(guest, WS_EVENTS.SUBMIT_VOTE, { value: 40 });
      expect(rejected).toMatchObject({ ok: false, error: 'bad_request' });

      await emit(guest, WS_EVENTS.SUBMIT_VOTE, { value: 3 });
      await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 3 });

      const ack = await emit<RoundResult>(master, WS_EVENTS.REVEAL_CARDS);
      expect(ack.ok && ack.data).toMatchObject({ average: null, min: 3, max: 3, agreement: 100 });
    });

    it('ссылки на задачу правит любой участник и видят все, даже без активного раунда', async () => {
      const owner = await newUser('links-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();

      const masterState = await joinRoom(master, roomId);
      await joinRoom(guest, roomId, 'Гость');
      expect(masterState.round).toBeNull();

      const masterSeesLinks = nextState(master);
      const updated = await emit(guest, WS_EVENTS.UPDATE_LINKS, {
        jiraUrl: 'https://jira.example.com/TASK-7',
        confluenceUrl: 'https://confluence.example.com/page',
      });

      expect(updated.ok).toBe(true);
      expect((await masterSeesLinks).room).toMatchObject({
        jiraUrl: 'https://jira.example.com/TASK-7',
        confluenceUrl: 'https://confluence.example.com/page',
      });
    });

    it('участник может передумать, пока карты не вскрыты', async () => {
      const owner = await newUser('revote-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);

      await joinRoom(master, roomId);
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 2 });
      await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 13 });

      const own = nextState(master);
      await emit(master, WS_EVENTS.REVEAL_CARDS);
      const revealed = await own;

      expect(revealed.result?.votes).toHaveLength(1);
      expect(revealed.result).toMatchObject({ average: 13, min: 13, max: 13 });
    });

    it('без входа в комнату события не принимаются', async () => {
      const client = connect();

      const ack = await emit(client, WS_EVENTS.SUBMIT_VOTE, { value: 3 });

      expect(ack).toMatchObject({ ok: false, error: 'forbidden' });
    });

    it('вскрывать нечего, пока никто не проголосовал', async () => {
      const owner = await newUser('empty-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });

      const ack = await emit(master, WS_EVENTS.REVEAL_CARDS);

      expect(ack).toMatchObject({ ok: false, error: 'conflict' });
    });

    it('гость возвращается по своему токену и сохраняет голос', async () => {
      const owner = await newUser('reconnect-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      const first = await join(guest, roomId, { guestName: 'Гостья' });
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      await emit(guest, WS_EVENTS.SUBMIT_VOTE, { value: 5 });

      guest.close();
      const returning = connect();
      const second = await join(returning, roomId, {
        guestName: 'Гостья',
        guestToken: first.guestToken as string,
      });

      expect(second.participantId).toBe(first.participantId);
      const self = second.state.participants.find(
        (participant) => participant.participantId === first.participantId,
      );
      expect(self?.hasVoted).toBe(true);
    });

    it('чужой идентификатор без токена не даёт занять место участника', async () => {
      const owner = await newUser('spoof-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const victim = connect();
      await joinRoom(master, roomId);
      const victimJoin = await join(victim, roomId, { guestName: 'Жертва' });

      // Идентификатор участника публичен — он приходит всем в составе комнаты
      const attacker = connect();
      const attackerJoin = await join(attacker, roomId, {
        guestName: 'Злодей',
        guestToken: victimJoin.participantId,
      });

      expect(attackerJoin.participantId).not.toBe(victimJoin.participantId);
    });

    it('вход во вторую комнату отписывает от первой', async () => {
      const owner = await newUser('two-rooms-owner');
      const first = await newRoom(owner, 'Первая');
      const second = await newRoom(owner, 'Вторая');
      const master = connect(owner);
      const watcher = connect();
      await joinRoom(master, first);
      await joinRoom(watcher, first, 'Наблюдатель');
      await joinRoom(watcher, second, 'Наблюдатель');

      // Рассылка первой комнаты до наблюдателя больше не доходит
      const leaked = nextState(watcher).then(
        () => 'пришло',
        () => 'не пришло',
      );
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });

      expect(await leaked).toBe('не пришло');
    });

    it('повторное вскрытие не меняет результат', async () => {
      const owner = await newUser('double-reveal-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 8 });

      const first = await emit<{ average: number }>(master, WS_EVENTS.REVEAL_CARDS);
      const second = await emit<{ average: number }>(master, WS_EVENTS.REVEAL_CARDS);

      expect(first.ok && second.ok).toBe(true);
      expect(second.ok && second.data.average).toBe(8);
    });

    it('битые данные события отклоняются, а не роняют сервер', async () => {
      const owner = await newUser('garbage-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);

      const badDeck = await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'колода' });
      const badRoom = await emit(master, WS_EVENTS.JOIN_ROOM, { roomId: 'не-uuid' });
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      const hugeVote = await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 2 ** 40 });

      expect(badDeck).toMatchObject({ ok: false, error: 'bad_request' });
      expect(badRoom).toMatchObject({ ok: false, error: 'bad_request' });
      expect(hugeVote).toMatchObject({ ok: false, error: 'bad_request' });

      // Сервер жив: обычное событие после мусора отрабатывает
      expect((await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 5 })).ok).toBe(true);
    });

    it('подтверждение не-функцией не роняет процесс', async () => {
      const owner = await newUser('bad-ack-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);

      // Вместо колбэка — объект: сервер не должен на этом упасть
      master.emit(WS_EVENTS.JOIN_ROOM, { roomId }, {});
      await new Promise((resolve) => setTimeout(resolve, 200));

      const alive = await emit(connect(owner), WS_EVENTS.JOIN_ROOM, { roomId });
      expect(alive.ok).toBe(true);
    });

    it('правка ссылок поверх чужой отклоняется по версии', async () => {
      const owner = await newUser('links-version-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      const masterState = await joinRoom(master, roomId);
      await joinRoom(guest, roomId, 'Гость');

      const version = masterState.room.linksVersion;

      // Оба видели одну и ту же версию ссылок, но правит их первый
      const first = await emit(guest, WS_EVENTS.UPDATE_LINKS, {
        jiraUrl: 'https://jira.example.com/GUEST',
        version,
      });
      const stale = await emit(master, WS_EVENTS.UPDATE_LINKS, {
        jiraUrl: 'https://jira.example.com/MASTER',
        version,
      });

      expect(first.ok).toBe(true);
      expect(stale).toMatchObject({ ok: false, error: 'conflict' });
    });

    it('оценка за прошлую задачу отбивается с конфликтом', async () => {
      const owner = await newUser('late-vote-ws-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);

      const first = await emit<Round>(master, WS_EVENTS.START_NEW_ROUND, {
        deckType: 'fibonacci',
      });
      const firstRoundId = first.ok ? first.data.id : '';
      await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 5, roundId: firstRoundId });
      await emit(master, WS_EVENTS.REVEAL_CARDS);
      await emit(master, WS_EVENTS.START_NEW_ROUND, {
        deckType: 'fibonacci',
        fromRoundId: firstRoundId,
      });

      const late = await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 8, roundId: firstRoundId });

      expect(late).toMatchObject({ ok: false, error: 'conflict' });
    });

    it('повторный старт раунда возвращает текущий, а не создаёт новый', async () => {
      const owner = await newUser('idempotent-start-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);

      const first = await emit<Round>(master, WS_EVENTS.START_NEW_ROUND, {
        deckType: 'fibonacci',
      });
      const fromRoundId = first.ok ? first.data.id : '';
      const again = await emit<Round>(master, WS_EVENTS.START_NEW_ROUND, {
        deckType: 'fibonacci',
        fromRoundId: null,
      });

      // Клиент считал, что раунда ещё нет, — сервер вернул уже начатый
      expect(again.ok && again.data.id).toBe(fromRoundId);
      expect(again.ok && again.data.seq).toBe(1);
    });

    it('уход участника виден остальным', async () => {
      const owner = await newUser('leave-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      await joinRoom(guest, roomId, 'Уходящий');

      const masterSeesLeave = nextState(master);
      guest.close();

      expect((await masterSeesLeave).participants).toHaveLength(1);
    });
  });

  describe('исключение участника из комнаты — 5.8', () => {
    /** Ждёт адресное событие о собственном исключении */
    function nextKicked(client: Socket): Promise<void> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('kicked не пришёл')), ANSWER_TIMEOUT_MS);
        client.once(WS_SERVER_EVENTS.KICKED, () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    it('скрам-мастер исключает участника: тот получает kicked и пропадает у остальных', async () => {
      const owner = await newUser('kick-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      const guestJoin = await join(guest, roomId, { guestName: 'Отпускник' });

      const guestKicked = nextKicked(guest);
      const masterSeesKick = nextState(master);
      const ack = await emit(master, WS_EVENTS.KICK_PARTICIPANT, {
        participantId: guestJoin.participantId,
      });

      expect(ack.ok).toBe(true);
      await guestKicked;
      expect((await masterSeesKick).participants).toHaveLength(1);
    });

    it('голосующий не может исключить участника', async () => {
      const owner = await newUser('kick-forbidden-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      await joinRoom(guest, roomId, 'Обычный участник');

      const ack = await emit(guest, WS_EVENTS.KICK_PARTICIPANT, {
        participantId: owner.id,
      });

      expect(ack).toMatchObject({ ok: false, error: 'forbidden' });
    });

    it('нельзя исключить самого себя', async () => {
      const owner = await newUser('kick-self-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);

      const ack = await emit(master, WS_EVENTS.KICK_PARTICIPANT, { participantId: owner.id });

      expect(ack).toMatchObject({ ok: false, error: 'forbidden' });
    });

    it('исключение уже отсутствующего участника не роняет запрос', async () => {
      const owner = await newUser('kick-ghost-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);

      const ack = await emit(master, WS_EVENTS.KICK_PARTICIPANT, {
        participantId: randomUUID(),
      });

      expect(ack.ok).toBe(true);
    });
  });

  describe('реакции-эмодзи на карточке участника — 10.10', () => {
    it('участник ставит реакцию другому — она видна всем в комнате', async () => {
      const owner = await newUser('reaction-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      const guestJoin = await join(guest, roomId, { guestName: 'Реагирующий' });

      const guestSeesReaction = nextState(guest);
      const ack = await emit(master, WS_EVENTS.SEND_REACTION, {
        targetParticipantId: guestJoin.participantId,
        emoji: '👍',
      });

      expect(ack.ok).toBe(true);
      const state = await guestSeesReaction;
      expect(state.reactions).toEqual([
        { fromParticipantId: owner.id, toParticipantId: guestJoin.participantId, emoji: '👍' },
      ]);
    });

    it('повторная реакция того же автора тому же адресату заменяет предыдущую', async () => {
      const owner = await newUser('reaction-replace-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      const guestJoin = await join(guest, roomId, { guestName: 'Реагирующий' });

      const firstBroadcast = nextState(guest);
      await emit(master, WS_EVENTS.SEND_REACTION, {
        targetParticipantId: guestJoin.participantId,
        emoji: '👍',
      });
      // Ждём, пока гость реально получит первую рассылку, прежде чем слушать вторую —
      // иначе `nextState` ниже может поймать ещё не доставленную первую рассылку
      await firstBroadcast;

      const replaced = nextState(guest);
      await emit(master, WS_EVENTS.SEND_REACTION, {
        targetParticipantId: guestJoin.participantId,
        emoji: '😂',
      });

      expect((await replaced).reactions).toEqual([
        { fromParticipantId: owner.id, toParticipantId: guestJoin.participantId, emoji: '😂' },
      ]);
    });

    it('повторная присылка уже стоящей реакции снимает её (клик по своему бейджу в UI)', async () => {
      const owner = await newUser('reaction-toggle-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      const guestJoin = await join(guest, roomId, { guestName: 'Реагирующий' });

      const firstBroadcast = nextState(guest);
      await emit(master, WS_EVENTS.SEND_REACTION, {
        targetParticipantId: guestJoin.participantId,
        emoji: '👍',
      });
      await firstBroadcast;

      const afterToggleOff = nextState(guest);
      await emit(master, WS_EVENTS.SEND_REACTION, {
        targetParticipantId: guestJoin.participantId,
        emoji: '👍',
      });

      expect((await afterToggleOff).reactions).toEqual([]);
    });

    it('можно отправить реакцию самому себе', async () => {
      const owner = await newUser('reaction-self-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);

      const selfSeesReaction = nextState(master);
      const ack = await emit(master, WS_EVENTS.SEND_REACTION, {
        targetParticipantId: owner.id,
        emoji: '👍',
      });

      expect(ack.ok).toBe(true);
      const state = await selfSeesReaction;
      expect(state.reactions).toEqual([
        { fromParticipantId: owner.id, toParticipantId: owner.id, emoji: '👍' },
      ]);
    });

    it('недопустимый эмодзи отклоняется', async () => {
      const owner = await newUser('reaction-invalid-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      const guestJoin = await join(guest, roomId, { guestName: 'Реагирующий' });

      const ack = await emit(master, WS_EVENTS.SEND_REACTION, {
        targetParticipantId: guestJoin.participantId,
        emoji: '🍕',
      });

      expect(ack).toMatchObject({ ok: false, error: 'bad_request' });
    });

    it('реакция на отсутствующего в комнате участника отклоняется', async () => {
      const owner = await newUser('reaction-ghost-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);

      const ack = await emit(master, WS_EVENTS.SEND_REACTION, {
        targetParticipantId: randomUUID(),
        emoji: '👍',
      });

      expect(ack).toMatchObject({ ok: false, error: 'bad_request' });
    });

    it('новый раунд сбрасывает реакции прошлого', async () => {
      const owner = await newUser('reaction-round-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      const guestJoin = await join(guest, roomId, { guestName: 'Реагирующий' });

      const firstBroadcast = nextState(guest);
      await emit(master, WS_EVENTS.SEND_REACTION, {
        targetParticipantId: guestJoin.participantId,
        emoji: '👍',
      });
      await firstBroadcast;

      const afterNewRound = nextState(guest);
      const ack = await emit<Round>(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });

      expect(ack.ok).toBe(true);
      expect((await afterNewRound).reactions).toEqual([]);
    });
  });

  describe('таймер обсуждения', () => {
    it('новая комната отдаёт таймер по умолчанию: 5 минут, не запущен', async () => {
      const owner = await newUser('timer-default-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);

      const state = await joinRoom(master, roomId);

      expect(state.timer).toMatchObject({ durationSec: 300, running: false, endsAt: null });
    });

    it('гость может стартовать, ставить на паузу и сбрасывать таймер — рассылка уходит всем', async () => {
      const owner = await newUser('timer-control-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      await joinRoom(guest, roomId, 'Таймер-гость');

      const masterSeesStart = nextState(master);
      const started = await emit(guest, WS_EVENTS.START_TIMER);
      expect(started.ok).toBe(true);
      const afterStart = await masterSeesStart;
      expect(afterStart.timer.running).toBe(true);
      expect(afterStart.timer.endsAt).not.toBeNull();

      const masterSeesPause = nextState(master);
      const paused = await emit(guest, WS_EVENTS.PAUSE_TIMER);
      expect(paused.ok).toBe(true);
      const afterPause = await masterSeesPause;
      expect(afterPause.timer).toMatchObject({ running: false, endsAt: null });
      expect(afterPause.timer.remainingSec).toBeLessThanOrEqual(300);

      const masterSeesReset = nextState(master);
      const reset = await emit(guest, WS_EVENTS.RESET_TIMER, { durationSec: 600 });
      expect(reset.ok).toBe(true);
      const afterReset = await masterSeesReset;
      expect(afterReset.timer).toMatchObject({
        durationSec: 600,
        running: false,
        endsAt: null,
        remainingSec: 600,
      });
    });

    it('таймер обсуждения не работает в архивной комнате — 6.2', async () => {
      const owner = await newUser('timer-archived-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);
      await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/archive`,
        headers: as(owner),
      });

      const started = await emit(master, WS_EVENTS.START_TIMER);
      expect(started).toMatchObject({ ok: false, error: 'conflict' });

      const paused = await emit(master, WS_EVENTS.PAUSE_TIMER);
      expect(paused).toMatchObject({ ok: false, error: 'conflict' });

      const reset = await emit(master, WS_EVENTS.RESET_TIMER, { durationSec: 600 });
      expect(reset).toMatchObject({ ok: false, error: 'conflict' });
    });

    it('произвольная длительность (не из пресетов) отклоняется', async () => {
      const owner = await newUser('timer-bad-duration-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);

      const ack = await emit(master, WS_EVENTS.RESET_TIMER, { durationSec: 42 });

      expect(ack).toMatchObject({ ok: false, error: 'bad_request' });
    });

    it('новый раунд сбрасывает таймер обсуждения предыдущей задачи', async () => {
      const owner = await newUser('timer-round-reset-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      await emit(master, WS_EVENTS.START_TIMER);

      const masterSeesNewRound = nextState(master);
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'scale_0_5' });
      const fresh = await masterSeesNewRound;

      expect(fresh.timer).toMatchObject({ running: false, endsAt: null, remainingSec: 300 });
    });

    it('таймер прошлой комнаты не утекает: переход на живом сокете без дисконнекта чистит её состояние', async () => {
      const ownerA = await newUser('timer-leak-owner-a');
      const roomA = await newRoom(ownerA, 'Таймер: комната А');
      const ownerB = await newUser('timer-leak-owner-b');
      const roomB = await newRoom(ownerB, 'Таймер: комната Б');

      const client = connect(ownerA);
      await joinRoom(client, roomA);
      expect((await emit(client, WS_EVENTS.START_TIMER)).ok).toBe(true);

      // Тот же сокет уходит в другую комнату без разрыва соединения — roomA пустеет
      await joinRoom(client, roomB);

      // Новый участник заходит в опустевшую комнату А: если состояние не почистили,
      // он увидит чужой «бегущий» таймер вместо дефолтного
      const fresh = connect();
      const freshState = await joinRoom(fresh, roomA, 'Новый гость');
      expect(freshState.timer).toMatchObject({
        durationSec: 300,
        running: false,
        endsAt: null,
        remainingSec: 300,
      });
    });

    it('одновременные события над таймером не оставляют «рваного» состояния', async () => {
      const owner = await newUser('timer-concurrent-owner');
      const roomId = await newRoom(owner, 'Таймер: гонка событий');
      const master = connect(owner);
      const guest = connect();
      await joinRoom(master, roomId);
      await joinRoom(guest, roomId, 'Параллельный гость');

      const [startAck, resetAck] = await Promise.all([
        emit(guest, WS_EVENTS.START_TIMER),
        emit(master, WS_EVENTS.RESET_TIMER, { durationSec: 900 }),
      ]);
      expect(startAck.ok).toBe(true);
      expect(resetAck.ok).toBe(true);

      // Независимый наблюдатель забирает окончательный снимок — какое бы из двух
      // действий ни применилось последним, состояние не должно быть гибридом
      // «идёт отсчёт, но endsAt пуст» или «остановлен, но endsAt заполнен»
      const observer = connect();
      const observed = await joinRoom(observer, roomId, 'Наблюдатель');
      if (observed.timer.running) {
        expect(observed.timer.endsAt).not.toBeNull();
      } else {
        expect(observed.timer.endsAt).toBeNull();
      }
    });
  });

  /**
   * Одновременные действия за столом. Сервис зовём напрямую: так события
   * уходят в базу параллельно, без очереди одного сокета.
   */
  describe('одновременные действия', () => {
    let service: RoomsService;

    function asMaster(user: AuthUser): ParticipantIdentity {
      return {
        participantId: user.id,
        userId: user.id,
        name: user.name,
        avatarUrl: null,
        isGuest: false,
        role: 'scrum_master',
      };
    }

    function asGuest(name: string): ParticipantIdentity {
      return {
        participantId: randomUUID(),
        userId: null,
        name,
        avatarUrl: null,
        isGuest: true,
        role: 'voter',
      };
    }

    beforeAll(() => {
      service = RoomsService.forDatabase(db, authConfig.guestSecret);
    });

    it('голоса в момент вскрытия не расходятся с зафиксированным средним', async () => {
      const owner = await newUser('race-reveal-owner');
      const roomId = await newRoom(owner);
      const master = asMaster(owner);
      const guests = ['Аня', 'Борис', 'Вера', 'Глеб', 'Дина'].map(asGuest);

      // Одна попытка может и разойтись с гонкой — повторяем несколько раз
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await service.startNewRound(roomId, master, { deckType: 'fibonacci' });
        await service.submitVote(roomId, master, { value: 1 });

        // Голоса летят одновременно со вскрытием: часть успеет, часть получит отказ
        await Promise.allSettled([
          ...guests.map((guest) => service.submitVote(roomId, guest, { value: 8 })),
          service.revealCards(roomId, master),
        ]);

        const { result } = await service.getState(roomId, []);
        expect(result).not.toBeNull();
        const values = (result?.votes ?? []).map((vote) => vote.value);
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        // Среднее в раунде посчитано ровно по тем оценкам, которые показаны участникам
        expect(result?.average).toBe(Math.round(mean * 100) / 100);
      }
    });

    it('двойной старт раунда не плодит лишние раунды', async () => {
      const owner = await newUser('race-round-owner');
      const roomId = await newRoom(owner);
      const master = asMaster(owner);
      const first = await service.startNewRound(roomId, master, { deckType: 'fibonacci' });

      // Оба запроса отталкиваются от одного и того же раунда — это один и тот же клик
      const [left, right] = await Promise.all([
        service.startNewRound(roomId, master, {
          deckType: 'fibonacci',
          fromRoundId: first.id,
        }),
        service.startNewRound(roomId, master, {
          deckType: 'fibonacci',
          fromRoundId: first.id,
        }),
      ]);

      expect(left.id).toBe(right.id);
      const rounds = await db.select().from(schema.rounds).where(eq(schema.rounds.roomId, roomId));
      expect(rounds).toHaveLength(2);
    });

    it('одновременная правка ссылок: побеждает один, второй узнаёт о конфликте', async () => {
      const owner = await newUser('race-links-owner');
      const roomId = await newRoom(owner);
      const room = await service.getRoom(roomId);

      const attempts = await Promise.allSettled([
        service.updateLinks(roomId, {
          jiraUrl: 'https://jira.example.com/LEFT',
          version: room.linksVersion,
        }),
        service.updateLinks(roomId, {
          jiraUrl: 'https://jira.example.com/RIGHT',
          version: room.linksVersion,
        }),
      ]);

      const saved = attempts.filter((attempt) => attempt.status === 'fulfilled');
      const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
      expect(saved).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(ConflictError);
      // Версия выросла ровно на одну правку — чужой текст не затёрт вторым разом
      expect((saved[0] as PromiseFulfilledResult<Room>).value.linksVersion).toBe(
        room.linksVersion + 1,
      );
    });

    it('опоздавший голос не попадает в следующую задачу', async () => {
      const owner = await newUser('race-late-vote-owner');
      const roomId = await newRoom(owner);
      const master = asMaster(owner);
      const guest = asGuest('Опоздавшая');
      const first = await service.startNewRound(roomId, master, { deckType: 'fibonacci' });
      await service.submitVote(roomId, master, { value: 5 });
      await service.revealCards(roomId, master);
      await service.startNewRound(roomId, master, {
        deckType: 'fibonacci',
        fromRoundId: first.id,
      });

      // Гость нажал карту, ещё видя прошлую задачу
      await expect(
        service.submitVote(roomId, guest, { value: 13, roundId: first.id }),
      ).rejects.toBeInstanceOf(ConflictError);

      const { participants } = await service.getState(roomId, [guest]);
      expect(participants[0]?.hasVoted).toBe(false);
    });

    it('номер изменения комнаты растёт с каждым действием', async () => {
      const owner = await newUser('race-revision-owner');
      const roomId = await newRoom(owner);
      const master = asMaster(owner);

      const start = (await service.getState(roomId, [])).room.revision;
      await service.startNewRound(roomId, master, { deckType: 'fibonacci' });
      const afterRound = (await service.getState(roomId, [])).room.revision;
      await service.submitVote(roomId, master, { value: 3 });
      const afterVote = (await service.getState(roomId, [])).room.revision;

      expect(afterRound).toBeGreaterThan(start);
      expect(afterVote).toBeGreaterThan(afterRound);
    });

    it('холостые действия не двигают номер изменения', async () => {
      const owner = await newUser('race-noop-owner');
      const roomId = await newRoom(owner);
      const master = asMaster(owner);
      const started = await service.startNewRound(roomId, master, { deckType: 'fibonacci' });

      const before = (await service.getState(roomId, [])).room.revision;
      await service.updateLinks(roomId, {});
      await service.startNewRound(roomId, master, {
        deckType: 'fibonacci',
        fromRoundId: randomUUID(),
      });
      const after = (await service.getState(roomId, [])).room.revision;

      expect(after).toBe(before);
      // Повторный старт вернул текущий раунд, а не создал новый
      expect((await service.getState(roomId, [])).round?.id).toBe(started.id);
    });

    it('правка без версии остаётся прежней: побеждает последний', async () => {
      const owner = await newUser('race-links-legacy-owner');
      const roomId = await newRoom(owner);

      const updated = await service.updateLinks(roomId, {
        jiraUrl: 'https://jira.example.com/LEGACY',
      });

      expect(updated.jiraUrl).toBe('https://jira.example.com/LEGACY');
    });

    it('снимок getState не рвётся, даже если чужой голос коммитится между внутренними запросами — 7.14', async () => {
      const owner = await newUser('race-torn-owner');
      const roomId = await newRoom(owner);
      const master = asMaster(owner);
      const guestA = asGuest('Успевший');
      const guestB = asGuest('Опоздавший');
      await service.startNewRound(roomId, master, { deckType: 'fibonacci' });
      await service.submitVote(roomId, guestA, { value: 3 });

      // Задерживаем только чтение голосов: submitVote его не вызывает,
      // поэтому конкурентный голос гарантированно не попадёт под задержку сам
      const originalListVotes = RoomsRepository.prototype.listVotes;
      const spy = vi
        .spyOn(RoomsRepository.prototype, 'listVotes')
        .mockImplementationOnce(async function (this: RoomsRepository, roundId: string) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          return originalListVotes.call(this, roundId);
        });

      try {
        const pending = service.getState(roomId, [master, guestA, guestB]);
        // Коммитится, пока getState ждёт внутри своей repeatable read транзакции
        await service.submitVote(roomId, guestB, { value: 5 });
        const state = await pending;

        const votedIds = new Set(
          state.participants.filter((p) => p.hasVoted).map((p) => p.participantId),
        );
        // Снимок зафиксирован до голоса guestB — тот не должен в нём появиться
        expect(votedIds.has(guestA.participantId)).toBe(true);
        expect(votedIds.has(guestB.participantId)).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it('без repeatable read та же гонка отдаёт голос из будущего — 7.14 (контрольный тест)', async () => {
      const owner = await newUser('race-torn-control-owner');
      const roomId = await newRoom(owner);
      const master = asMaster(owner);
      const guestA = asGuest('Успевший');
      const guestB = asGuest('Опоздавший');
      await service.startNewRound(roomId, master, { deckType: 'fibonacci' });
      await service.submitVote(roomId, guestA, { value: 3 });

      // Тот же порядок запросов, что и в getState, но нарочно на read committed —
      // без repeatable read каждый запрос внутри транзакции видит свежий коммит
      const readWithDelay = db.transaction(
        async (tx) => {
          const repo = new RoomsRepository(tx);
          const round = await repo.findCurrentRound(roomId);
          if (!round) {
            throw new Error('нет раунда');
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
          return repo.listVotes(round.id);
        },
        { isolationLevel: 'read committed', accessMode: 'read only' },
      );

      await service.submitVote(roomId, guestB, { value: 5 });
      const votes = await readWithDelay;

      // В отличие от repeatable read, здесь голос guestB виден тому же чтению —
      // это и есть рваный снимок, от которого защищает repeatable read в getState
      expect(votes.some((vote) => vote.participantId === guestB.participantId)).toBe(true);
    });
  });

  describe('rate limit на /api/rooms/* (7.34)', () => {
    // Свежий инстанс на каждый тест (без переопределения лимита) — у общего
    // `app` файла лимит завышен нарочно (см. beforeAll), эти тесты проверяют
    // настоящий production-порог
    const ROOMS_RATE_LIMIT_MAX = 30; // должно совпадать с константой в src/rooms/plugin.ts

    it('после превышения лимита конкретного маршрута отвечает 429 в общем формате ошибок', async () => {
      const limitedApp = buildApp({ db, auth: authConfig });
      await limitedApp.ready();
      try {
        const url = `/api/rooms/${randomUUID()}`;
        let last: Awaited<ReturnType<typeof limitedApp.inject>> | undefined;
        for (let i = 0; i < ROOMS_RATE_LIMIT_MAX + 1; i++) {
          last = await limitedApp.inject({ method: 'GET', url });
        }
        expect(last?.statusCode).toBe(429);
        expect(last?.json()).toMatchObject({ error: 'too_many_requests' });
      } finally {
        await limitedApp.close();
      }
    });

    it('исчерпанный лимит одного маршрута не трогает бюджет другого', async () => {
      const limitedApp = buildApp({ db, auth: authConfig });
      await limitedApp.ready();
      try {
        // Один и тот же роут /api/rooms/:id делит бюджет независимо от id в пути
        for (let i = 0; i < ROOMS_RATE_LIMIT_MAX + 1; i++) {
          await limitedApp.inject({ method: 'GET', url: `/api/rooms/${randomUUID()}` });
        }

        const res = await limitedApp.inject({
          method: 'GET',
          url: `/api/rooms/${randomUUID()}/rounds`,
        });

        expect(res.statusCode).not.toBe(429);
      } finally {
        await limitedApp.close();
      }
    });
  });
});
