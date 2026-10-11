/**
 * Два экземпляра сервера на общих PostgreSQL и Redis (10.18): клиенты сидят на
 * разных экземплярах, а комната и доска для них — одни и те же. Без
 * DATABASE_URL или REDIS_URL — пропускается. Каждый прогон — в своём префиксе
 * ключей и канала рассылок, чтобы не пересекаться с dev-сервером на том же Redis.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import type {
  AuthUser,
  BoardItem,
  BoardOpsBatch,
  BoardPresenceUpdate,
  BoardVotingState,
  JoinBoardResult,
  JoinRoomResult,
  RoomState,
  WsAck,
} from '@estimate/shared';
import {
  BOARD_WS_EVENTS,
  BOARD_WS_SERVER_EVENTS,
  WS_EVENTS,
  WS_SERVER_EVENTS,
} from '@estimate/shared';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Socket, io as createClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, TokenService, UsersRepository } from '../src/auth';
import { BoardsService, BoardVotingService } from '../src/boards';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';
import { connectRedisCluster, type RedisCluster } from '../src/platform/realtime';
import { RoomsGameService } from '../src/rooms';
import { SocketGateway } from '../src/socket';
import { TeamsRepository, TeamsService } from '../src/teams';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // нет .env — переменные из окружения (CI)
}

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

const authConfig: AuthConfig = {
  jwtSecret: 'секрет-для-тестов-длиннее-тридцати-двух-символов',
  guestSecret: 'гостевой-секрет-для-тестов-длиннее-тридцати-двух',
  publicOrigin: 'http://localhost:3000',
  webOrigin: 'http://localhost:5173',
  cookieSecure: false,
  providers: {},
};

const ANSWER_TIMEOUT_MS = 3_000;
const ROOMS_RATE_LIMIT_MAX = 4;

interface Node {
  app: FastifyInstance;
  port: number;
  cluster: RedisCluster;
}

describe.runIf(databaseUrl && redisUrl)('Два экземпляра сервера (10.18)', () => {
  const keyPrefix = `estimate:test:${randomUUID()}:`;
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let teamsService: TeamsService;
  let teamsRepository: TeamsRepository;
  const nodes: Node[] = [];
  const userIds: string[] = [];
  const teamIds: string[] = [];
  const boardIds: string[] = [];
  const roomIds: string[] = [];
  const clients: Socket[] = [];

  async function startNode(): Promise<Node> {
    const cluster = connectRedisCluster(redisUrl!, () => {}, keyPrefix);
    const app = buildApp({
      db,
      auth: authConfig,
      redis: cluster.client,
      roomsRateLimit: { max: ROOMS_RATE_LIMIT_MAX, timeWindow: '1 minute' },
    });
    const roomsService = RoomsGameService.forDatabase(db, authConfig.guestSecret);
    const boardsService = BoardsService.forDatabase(db, authConfig.guestSecret);
    new SocketGateway(roomsService, boardsService, {
      corsOrigin: '*',
      boardVoting: new BoardVotingService(db, boardsService),
      cluster: { store: cluster.store, adapter: cluster.adapter },
    }).attach(app);
    app.addHook('onClose', async () => {
      await cluster.close();
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    return { app, port: (app.server.address() as AddressInfo).port, cluster };
  }

  function as(user: AuthUser): { cookie: string } {
    const token = new TokenService(nodes[0]!.app.jwt, false).issue(user.id, randomUUID()).access;
    return { cookie: `${ACCESS_COOKIE}=${token}` };
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

  async function newRoom(owner: AuthUser): Promise<string> {
    const res = await nodes[0]!.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: as(owner),
      payload: { name: 'Оценка на двух экземплярах' },
    });
    const { room } = res.json() as { room: { id: string } };
    roomIds.push(room.id);
    return room.id;
  }

  async function newTeamBoard(owner: AuthUser, member: AuthUser): Promise<string> {
    const team = await teamsService.create(owner.id, `Команда ${randomUUID().slice(0, 8)}`);
    teamIds.push(team.id);
    await teamsRepository.insertMemberIfAbsent(team.id, member.id, 'member');
    const res = await nodes[0]!.app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: as(owner),
      payload: { title: 'Доска на двух экземплярах', teamId: team.id },
    });
    const { board } = res.json() as { board: { id: string } };
    boardIds.push(board.id);
    return board.id;
  }

  function connect(node: Node, user?: AuthUser): Socket {
    const client = createClient(`http://127.0.0.1:${node.port}`, {
      transports: ['websocket'],
      extraHeaders: user ? as(user) : {},
    });
    clients.push(client);
    return client;
  }

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
      if (payload === undefined) client.emit(event, done);
      else client.emit(event, payload, done);
    });
  }

  async function ok<T>(client: Socket, event: string, payload?: unknown): Promise<T> {
    const ack = await emit<T>(client, event, payload);
    if (!ack.ok) throw new Error(`${event}: ${ack.message}`);
    return ack.data;
  }

  /** Первое событие, удовлетворяющее условию: рассылки с двух экземпляров идут вперемешку */
  function waitUntil<T>(client: Socket, event: string, match: (payload: T) => boolean): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.off(event, listener);
        reject(new Error(`${event} с нужным содержимым не пришло`));
      }, ANSWER_TIMEOUT_MS);
      const listener = (payload: T): void => {
        if (!match(payload)) return;
        clearTimeout(timer);
        client.off(event, listener);
        resolve(payload);
      };
      client.on(event, listener);
    });
  }

  function sticky(): Omit<BoardItem, 'boardId' | 'createdBy' | 'updatedAt'> {
    return {
      id: randomUUID(),
      parentId: null,
      x: 10,
      y: 10,
      width: 160,
      height: 120,
      rotation: 0,
      zIndex: 0,
      content: { type: 'sticky', text: 'Привет' },
      style: { color: '#FCEB96' },
      reactions: [],
    };
  }

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl!));
    teamsService = TeamsService.forDatabase(db);
    teamsRepository = new TeamsRepository(db);
    nodes.push(await startNode(), await startNode());
  });

  afterAll(async () => {
    try {
      for (const client of clients) client.close();
      for (const node of nodes) await node.app.close();
      if (roomIds.length > 0)
        await db.delete(schema.rooms).where(inArray(schema.rooms.id, roomIds));
      if (boardIds.length > 0) {
        await db.delete(schema.boards).where(inArray(schema.boards.id, boardIds));
      }
      if (teamIds.length > 0)
        await db.delete(schema.teams).where(inArray(schema.teams.id, teamIds));
      if (userIds.length > 0)
        await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    } finally {
      await pool?.end();
    }
  });

  describe('комната', () => {
    it('участники с разных экземпляров видят друг друга, таймер и реакции общие', async () => {
      const owner = await newUser('cluster-room-owner');
      const roomId = await newRoom(owner);
      const master = connect(nodes[0]!, owner);
      const guest = connect(nodes[1]!);
      const { participantId: masterId } = await ok<JoinRoomResult>(master, WS_EVENTS.JOIN_ROOM, {
        roomId,
      });

      const masterSeesGuest = waitUntil<RoomState>(
        master,
        WS_SERVER_EVENTS.ROOM_STATE,
        (s) => s.participants.length === 2,
      );
      const joined = await ok<JoinRoomResult>(guest, WS_EVENTS.JOIN_ROOM, {
        roomId,
        guestName: 'Гость',
      });
      expect(joined.state.participants).toHaveLength(2);
      await masterSeesGuest;

      // Таймер запущен на втором экземпляре — первый видит его в своём снимке
      const masterSeesTimer = waitUntil<RoomState>(
        master,
        WS_SERVER_EVENTS.ROOM_STATE,
        (s) => s.timer.running,
      );
      await ok(guest, WS_EVENTS.START_TIMER);
      const withTimer = await masterSeesTimer;
      expect(withTimer.seq).toBeGreaterThan(joined.state.seq);

      // Реакция гостя (второй экземпляр) на скрам-мастера (первый): адресат найден
      const masterSeesReaction = waitUntil<RoomState>(
        master,
        WS_SERVER_EVENTS.ROOM_STATE,
        (s) => s.reactions.length === 1,
      );
      await ok(guest, WS_EVENTS.SEND_REACTION, { targetParticipantId: masterId, emoji: '👍' });
      expect((await masterSeesReaction).reactions[0]).toMatchObject({
        toParticipantId: masterId,
        emoji: '👍',
      });
    });

    it('скрам-мастер исключает участника, сидящего на другом экземпляре', async () => {
      const owner = await newUser('cluster-kick-owner');
      const roomId = await newRoom(owner);
      const master = connect(nodes[0]!, owner);
      const guest = connect(nodes[1]!);
      await ok(master, WS_EVENTS.JOIN_ROOM, { roomId });
      const { participantId: guestId } = await ok<JoinRoomResult>(guest, WS_EVENTS.JOIN_ROOM, {
        roomId,
        guestName: 'Лишний',
      });

      const kicked = new Promise<void>((resolve) => guest.once(WS_SERVER_EVENTS.KICKED, resolve));
      const disconnected = new Promise<string>((resolve) =>
        guest.once('disconnect', (reason: string) => resolve(reason)),
      );
      const masterSeesAlone = waitUntil<RoomState>(
        master,
        WS_SERVER_EVENTS.ROOM_STATE,
        (s) => s.participants.length === 1,
      );
      await ok(master, WS_EVENTS.KICK_PARTICIPANT, { participantId: guestId });

      await kicked;
      expect(await disconnected).toBe('io server disconnect');
      await masterSeesAlone;
    });
  });

  describe('доска', () => {
    it('операции, присутствие и голосование доходят до участника на другом экземпляре', async () => {
      const owner = await newUser('cluster-board-owner');
      const member = await newUser('cluster-board-member');
      const boardId = await newTeamBoard(owner, member);
      const ownerClient = connect(nodes[0]!, owner);
      const memberClient = connect(nodes[1]!, member);
      await ok<JoinBoardResult>(ownerClient, BOARD_WS_EVENTS.JOIN, { boardId });

      const ownerSeesMember = waitUntil<BoardPresenceUpdate>(
        ownerClient,
        BOARD_WS_SERVER_EVENTS.PRESENCE,
        (u) => u.entries.length === 2,
      );
      await ok<JoinBoardResult>(memberClient, BOARD_WS_EVENTS.JOIN, { boardId });
      await ownerSeesMember;

      const item = sticky();
      const memberSeesOps = waitUntil<BoardOpsBatch>(
        memberClient,
        BOARD_WS_SERVER_EVENTS.OPS,
        () => true,
      );
      await ok(ownerClient, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: randomUUID(), item }],
      });
      expect((await memberSeesOps).ops[0]).toMatchObject({ type: 'item.create' });

      // Персональная рассылка голосования — и на чужой экземпляр
      const memberSeesVoting = waitUntil<BoardVotingState | null>(
        memberClient,
        BOARD_WS_SERVER_EVENTS.VOTING,
        (state) => state !== null,
      );
      await ok(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: null,
      });
      expect(await memberSeesVoting).not.toBeNull();
    });

    it('реконнект на другой экземпляр догоняет по буферу, а не полным снимком', async () => {
      const owner = await newUser('cluster-catchup-owner');
      const member = await newUser('cluster-catchup-member');
      const boardId = await newTeamBoard(owner, member);
      const ownerClient = connect(nodes[0]!, owner);
      await ok<JoinBoardResult>(ownerClient, BOARD_WS_EVENTS.JOIN, { boardId });
      // Держит доску непустой, пока участник «переподключается»
      const memberOnFirst = connect(nodes[0]!, member);
      const first = await ok<JoinBoardResult>(memberOnFirst, BOARD_WS_EVENTS.JOIN, { boardId });

      for (let i = 0; i < 3; i++) {
        await ok(ownerClient, BOARD_WS_EVENTS.APPLY, {
          ops: [{ type: 'item.create', clientOpId: randomUUID(), item: sticky() }],
        });
      }
      memberOnFirst.close();

      const memberOnSecond = connect(nodes[1]!, member);
      const rejoined = await ok<JoinBoardResult>(memberOnSecond, BOARD_WS_EVENTS.JOIN, {
        boardId,
        sinceRevision: first.revision,
      });

      expect(rejoined.snapshot).toBeNull();
      expect(rejoined.catchup?.map((b) => b.revision)).toEqual([
        first.revision + 1,
        first.revision + 2,
        first.revision + 3,
      ]);
    });

    it('доска стала личной — участника на другом экземпляре выводит из канала', async () => {
      const owner = await newUser('cluster-access-owner');
      const member = await newUser('cluster-access-member');
      const boardId = await newTeamBoard(owner, member);
      const memberClient = connect(nodes[1]!, member);
      await ok<JoinBoardResult>(memberClient, BOARD_WS_EVENTS.JOIN, { boardId });

      const accessChanged = new Promise<void>((resolve) =>
        memberClient.once(BOARD_WS_SERVER_EVENTS.ACCESS, () => resolve()),
      );
      const res = await nodes[0]!.app.inject({
        method: 'PATCH',
        url: `/api/boards/${boardId}/team`,
        headers: as(owner),
        payload: { teamId: null },
      });
      expect(res.statusCode).toBe(200);
      await accessChanged;
    });
  });

  it('лимит запросов общий для экземпляров', async () => {
    const user = await newUser('cluster-rate-limit');
    // Маршрут, который больше нигде в файле не вызывается: ключ лимита — IP и маршрут
    const statuses: number[] = [];
    for (let i = 0; i <= ROOMS_RATE_LIMIT_MAX; i++) {
      const res = await nodes[i % 2]!.app.inject({
        method: 'GET',
        url: `/api/rooms/${randomUUID()}`,
        headers: as(user),
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, ROOMS_RATE_LIMIT_MAX)).not.toContain(429);
    expect(statuses.at(-1)).toBe(429);
  });

  it('/health проверяет Redis', async () => {
    const res = await nodes[0]!.app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toMatchObject({ status: 'ok', redis: 'ok' });
  });
});
