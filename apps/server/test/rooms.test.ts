/**
 * Комнаты целиком: REST на реальной PostgreSQL и полный игровой цикл
 * по WebSocket с двумя клиентами. Без DATABASE_URL — пропускаются.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import type { AuthUser, JoinRoomResult, Round, RoomState, RoundResult, WsAck } from '@poker/shared';
import { WS_EVENTS, WS_SERVER_EVENTS } from '@poker/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Socket, io as createClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, TokenService, UsersRepository } from '../src/auth';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';
import { ConflictError } from '../src/errors';
import type { ParticipantIdentity } from '../src/rooms';
import { RoomsService } from '../src/rooms';
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
    return { cookie: `${ACCESS_COOKIE}=${new TokenService(app.jwt, false).issue(user.id).access}` };
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
    app = buildApp({ db, auth: authConfig });
    new SocketGateway({ corsOrigin: '*', guestSecret: authConfig.jwtSecret }).attach(app);
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

    it('закрыть комнату может только скрам-мастер', async () => {
      const owner = await newUser('close-owner');
      const stranger = await newUser('close-stranger');
      const roomId = await newRoom(owner);

      const byStranger = await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/close`,
        headers: as(stranger),
      });
      const byOwner = await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/close`,
        headers: as(owner),
      });

      expect(byStranger.statusCode).toBe(403);
      expect(byOwner.statusCode).toBe(200);
      expect(byOwner.json()).toMatchObject({ room: { status: 'closed' } });
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
      const started = await emit(master, WS_EVENTS.START_NEW_ROUND, {
        deckType: 'fibonacci',
        jiraUrl: 'https://jira.example.com/TASK-1',
      });
      expect(started.ok).toBe(true);
      const roundState = await guestSeesRound;
      expect(roundState.round).toMatchObject({
        seq: 1,
        deckType: 'fibonacci',
        status: 'voting',
        jiraUrl: 'https://jira.example.com/TASK-1',
      });

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

    it('ссылки на задачу правит любой участник и видят все', async () => {
      const owner = await newUser('links-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      const guest = connect();

      await joinRoom(master, roomId);
      await joinRoom(guest, roomId, 'Гость');
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });

      const masterSeesLinks = nextState(master);
      const updated = await emit(guest, WS_EVENTS.UPDATE_LINKS, {
        jiraUrl: 'https://jira.example.com/TASK-7',
        confluenceUrl: 'https://confluence.example.com/page',
      });

      expect(updated.ok).toBe(true);
      expect((await masterSeesLinks).round).toMatchObject({
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

    it('в закрытой комнате голосовать нельзя', async () => {
      const owner = await newUser('closed-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/close`,
        headers: as(owner),
      });

      const ack = await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 5 });

      expect(ack).toMatchObject({ ok: false, error: 'conflict' });
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

    it('вскрыть карты в закрытой комнате нельзя', async () => {
      const owner = await newUser('reveal-closed-owner');
      const roomId = await newRoom(owner);
      const master = connect(owner);
      await joinRoom(master, roomId);
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      await emit(master, WS_EVENTS.SUBMIT_VOTE, { value: 3 });
      await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/close`, headers: as(owner) });

      const ack = await emit(master, WS_EVENTS.REVEAL_CARDS);

      expect(ack).toMatchObject({ ok: false, error: 'conflict' });
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
      await joinRoom(master, roomId);
      await joinRoom(guest, roomId, 'Гость');

      const started = nextState(master);
      await emit(master, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' });
      const version = (await started).round?.linksVersion as number;

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
      service = RoomsService.forDatabase(db, authConfig.jwtSecret);
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
      const master = asMaster(owner);
      const started = await service.startNewRound(roomId, master, { deckType: 'fibonacci' });

      const attempts = await Promise.allSettled([
        service.updateLinks(roomId, {
          jiraUrl: 'https://jira.example.com/LEFT',
          version: started.linksVersion,
        }),
        service.updateLinks(roomId, {
          jiraUrl: 'https://jira.example.com/RIGHT',
          version: started.linksVersion,
        }),
      ]);

      const saved = attempts.filter((attempt) => attempt.status === 'fulfilled');
      const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
      expect(saved).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(ConflictError);
      // Версия выросла ровно на одну правку — чужой текст не затёрт вторым разом
      expect((saved[0] as PromiseFulfilledResult<Round>).value.linksVersion).toBe(
        started.linksVersion + 1,
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
      const master = asMaster(owner);
      await service.startNewRound(roomId, master, { deckType: 'fibonacci' });

      const updated = await service.updateLinks(roomId, {
        jiraUrl: 'https://jira.example.com/LEGACY',
      });

      expect(updated.jiraUrl).toBe('https://jira.example.com/LEGACY');
    });
  });
});
