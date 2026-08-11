/**
 * WS-канал досок (12.4) на реальной PostgreSQL и реальных сокетах: вход,
 * применение операций, права на каждом событии, presence, догон по
 * revision. Без DATABASE_URL — пропускается.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import type {
  ApplyBoardOpsResult,
  AuthUser,
  BoardItem,
  BoardOpsBatch,
  BoardPresenceEntry,
  JoinBoardResult,
  WsAck,
} from '@poker/shared';
import { BOARD_WS_EVENTS, BOARD_WS_SERVER_EVENTS } from '@poker/shared';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Socket, io as createClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, TokenService, UsersRepository } from '../src/auth';
import { BoardsService } from '../src/boards';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';
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
  guestSecret: 'гостевой-секрет-для-тестов-длиннее-тридцати-двух',
  publicOrigin: 'http://localhost:3000',
  webOrigin: 'http://localhost:5173',
  cookieSecure: false,
  providers: {},
};

const ANSWER_TIMEOUT_MS = 3_000;

function stickyItem(
  over: Partial<BoardItem> = {},
): Omit<BoardItem, 'boardId' | 'createdBy' | 'updatedAt'> {
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
    ...over,
  };
}

describeDb('WS-канал досок', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let app: FastifyInstance;
  let port: number;
  let teamsService: TeamsService;
  let teamsRepository: TeamsRepository;
  const userIds: string[] = [];
  const teamIds: string[] = [];
  const boardIds: string[] = [];
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

  async function newTeam(
    creator: AuthUser,
    members: Array<[AuthUser, 'admin' | 'member' | 'guest']> = [],
  ): Promise<string> {
    const team = await teamsService.create(creator.id, `Команда ${randomUUID().slice(0, 8)}`);
    teamIds.push(team.id);
    for (const [user, role] of members) {
      await teamsRepository.insertMemberIfAbsent(team.id, user.id, role);
    }
    return team.id;
  }

  async function newBoard(owner: AuthUser, teamId: string | null = null): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: as(owner),
      payload: { title: 'Доска для теста', teamId },
    });
    const { board } = res.json() as { board: { id: string } };
    boardIds.push(board.id);
    return board.id;
  }

  /** Клиент сокета: с кукой пользователя или без неё — тогда сервер видит анонима */
  function connect(user?: AuthUser): Socket {
    const client = createClient(`http://127.0.0.1:${port}`, {
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
      if (payload === undefined) {
        client.emit(event, done);
      } else {
        client.emit(event, payload, done);
      }
    });
  }

  async function joinBoard(
    client: Socket,
    boardId: string,
    sinceRevision?: number,
  ): Promise<JoinBoardResult> {
    const ack = await emit<JoinBoardResult>(client, BOARD_WS_EVENTS.JOIN, {
      boardId,
      sinceRevision,
    });
    if (!ack.ok) {
      throw new Error(`не удалось войти на доску: ${ack.message}`);
    }
    return ack.data;
  }

  function waitFor<T>(client: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} не пришло`)), ANSWER_TIMEOUT_MS);
      client.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  beforeAll(async () => {
    ({ db, pool } = createDb(databaseUrl as string));
    teamsService = TeamsService.forDatabase(db);
    teamsRepository = new TeamsRepository(db);
    app = buildApp({ db, auth: authConfig });
    const roomsService = RoomsService.forDatabase(db, authConfig.guestSecret);
    const boardsService = BoardsService.forDatabase(db);
    new SocketGateway(roomsService, boardsService, { corsOrigin: '*' }).attach(app);
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    try {
      for (const client of clients) {
        client.close();
      }
      await app?.close();
      if (boardIds.length > 0) {
        await db.delete(schema.boards).where(inArray(schema.boards.id, boardIds));
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

  describe('вход на доску', () => {
    it('владелец входит на личную доску и получает снимок', async () => {
      const owner = await newUser('board-owner');
      const boardId = await newBoard(owner);
      const client = connect(owner);

      const result = await joinBoard(client, boardId);

      expect(result.snapshot).not.toBeNull();
      expect(result.snapshot?.items).toEqual([]);
      expect(result.revision).toBe(0);
    });

    it('чужой личной доске отвечает not_found', async () => {
      const owner = await newUser('board-owner-2');
      const stranger = await newUser('stranger');
      const boardId = await newBoard(owner);
      const client = connect(stranger);

      const ack = await emit<JoinBoardResult>(client, BOARD_WS_EVENTS.JOIN, { boardId });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error).toBe('not_found');
    });

    it('участник команды (включая гостя) входит на командную доску', async () => {
      const owner = await newUser('team-board-owner');
      const guest = await newUser('team-board-guest');
      const teamId = await newTeam(owner, [[guest, 'guest']]);
      const boardId = await newBoard(owner, teamId);
      const client = connect(guest);

      const result = await joinBoard(client, boardId);

      expect(result.snapshot).not.toBeNull();
    });

    it('постороннему без команды отвечает not_found', async () => {
      const owner = await newUser('team-board-owner-2');
      const outsider = await newUser('outsider');
      const teamId = await newTeam(owner);
      const boardId = await newBoard(owner, teamId);
      const client = connect(outsider);

      const ack = await emit<JoinBoardResult>(client, BOARD_WS_EVENTS.JOIN, { boardId });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error).toBe('not_found');
    });

    it('анонимное подключение без куки получает unauthorized', async () => {
      const owner = await newUser('board-owner-3');
      const boardId = await newBoard(owner);
      const client = connect();

      const ack = await emit<JoinBoardResult>(client, BOARD_WS_EVENTS.JOIN, { boardId });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error).toBe('unauthorized');
    });
  });

  describe('применение операций', () => {
    it('создание стикера рассылается всем участникам доски, включая отправителя', async () => {
      const owner = await newUser('apply-owner');
      const boardId = await newBoard(owner);
      const senderClient = connect(owner);
      const viewerClient = connect(owner);
      await joinBoard(senderClient, boardId);
      await joinBoard(viewerClient, boardId);

      const item = stickyItem();
      const opsPromise = waitFor<BoardOpsBatch>(viewerClient, BOARD_WS_SERVER_EVENTS.OPS);
      const ack = await emit<ApplyBoardOpsResult>(senderClient, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item }],
      });
      const broadcast = await opsPromise;

      expect(ack.ok).toBe(true);
      if (ack.ok) expect(ack.data.revision).toBe(1);
      expect(broadcast.revision).toBe(1);
      expect(broadcast.ops).toHaveLength(1);
      const op = broadcast.ops[0]!;
      expect(op.type).toBe('item.create');
      if (op.type === 'item.create') {
        expect(op.item.id).toBe(item.id);
        expect(op.item.boardId).toBe(boardId);
        expect(op.item.createdBy).toBe(owner.id);
      }
    });

    it('гость команды не может править содержимое доски', async () => {
      const owner = await newUser('edit-owner');
      const guest = await newUser('edit-guest');
      const teamId = await newTeam(owner, [[guest, 'guest']]);
      const boardId = await newBoard(owner, teamId);
      const client = connect(guest);
      await joinBoard(client, boardId);

      const ack = await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item: stickyItem() }],
      });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error).toBe('forbidden');
    });

    it('участник команды (не только владелец/админ) может править содержимое', async () => {
      const owner = await newUser('edit-owner-2');
      const member = await newUser('edit-member');
      const teamId = await newTeam(owner, [[member, 'member']]);
      const boardId = await newBoard(owner, teamId);
      const client = connect(member);
      await joinBoard(client, boardId);

      const ack = await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item: stickyItem() }],
      });

      expect(ack.ok).toBe(true);
    });

    it('операции без входа на доску отклоняются', async () => {
      const owner = await newUser('apply-no-seat');
      const client = connect(owner);

      const ack = await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item: stickyItem() }],
      });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error).toBe('forbidden');
    });

    it('операции над архивной доской отклоняются', async () => {
      const owner = await newUser('archived-owner');
      const boardId = await newBoard(owner);
      await app.inject({
        method: 'POST',
        url: `/api/boards/${boardId}/archive`,
        headers: as(owner),
      });
      const client = connect(owner);
      await joinBoard(client, boardId);

      const ack = await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item: stickyItem() }],
      });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error).toBe('conflict');
    });

    it('патч и удаление применяются к ранее созданному элементу', async () => {
      const owner = await newUser('patch-owner');
      const boardId = await newBoard(owner);
      const client = connect(owner);
      await joinBoard(client, boardId);
      const item = stickyItem();
      await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item }],
      });

      const patchAck = await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.patch', clientOpId: 'c2', id: item.id, patch: { x: 500 } }],
      });
      expect(patchAck.ok).toBe(true);
      if (patchAck.ok) expect(patchAck.data.revision).toBe(2);

      const deleteAck = await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.delete', clientOpId: 'c3', id: item.id }],
      });
      expect(deleteAck.ok).toBe(true);
      if (deleteAck.ok) expect(deleteAck.data.revision).toBe(3);

      const snapshot = await joinBoard(connect(owner), boardId);
      expect(snapshot.snapshot?.items).toEqual([]);
    });

    it('патч не может переписать boardId и увести элемент на чужую доску', async () => {
      const owner = await newUser('patch-hijack-owner');
      const victimOwner = await newUser('patch-hijack-victim');
      const boardId = await newBoard(owner);
      const victimBoardId = await newBoard(victimOwner);
      const client = connect(owner);
      await joinBoard(client, boardId);
      const item = stickyItem();
      await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item }],
      });

      // Патч, помимо разрешённых полей, пытается протащить boardId — сырой JSON
      // с сокета, TypeScript тут не защищает от лишних полей во время выполнения
      const maliciousPatch = { x: 0, boardId: victimBoardId } as { x: number };
      const ack = await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.patch', clientOpId: 'c2', id: item.id, patch: maliciousPatch }],
      });
      expect(ack.ok).toBe(true);

      const ownBoard = await joinBoard(connect(owner), boardId);
      expect(ownBoard.snapshot?.items.map((i) => i.id)).toEqual([item.id]);
      const victimBoard = await joinBoard(connect(victimOwner), victimBoardId);
      expect(victimBoard.snapshot?.items).toEqual([]);
    });

    it('реакция рассылается всем участникам как item.patch и переживает пересоздание снимка (12.12)', async () => {
      const owner = await newUser('react-owner');
      const boardId = await newBoard(owner);
      const senderClient = connect(owner);
      const viewerClient = connect(owner);
      await joinBoard(senderClient, boardId);
      await joinBoard(viewerClient, boardId);
      const item = stickyItem();
      // Дожидаемся broadcast самого создания на viewerClient ДО того, как слушать
      // следующий — иначе гонка между ack и io.to().emit() на сервере могла бы
      // отдать этот же create-батч в опрашиваемый ниже waitFor вместо реакции
      const createOpsPromise = waitFor<BoardOpsBatch>(viewerClient, BOARD_WS_SERVER_EVENTS.OPS);
      await emit<ApplyBoardOpsResult>(senderClient, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item }],
      });
      await createOpsPromise;

      const opsPromise = waitFor<BoardOpsBatch>(viewerClient, BOARD_WS_SERVER_EVENTS.OPS);
      const ack = await emit<ApplyBoardOpsResult>(senderClient, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.react', clientOpId: 'c2', id: item.id, emoji: '👍' }],
      });
      const broadcast = await opsPromise;

      expect(ack.ok).toBe(true);
      // Рассылается как обычный item.patch — у реакций нет отдельного протокола
      // для остальных участников (см. boards.service.ts)
      expect(broadcast.ops).toHaveLength(1);
      const op = broadcast.ops[0]!;
      expect(op.type).toBe('item.patch');
      if (op.type === 'item.patch') {
        expect(op.item.reactions).toEqual([{ userId: owner.id, name: owner.name, emoji: '👍' }]);
      }

      // Переживает пересоздание снимка — настоящая персистентность в БД,
      // а не только оптимистичный вид у уже подключённых клиентов
      const fresh = await joinBoard(connect(owner), boardId);
      expect(fresh.snapshot?.items[0]?.reactions).toEqual([
        { userId: owner.id, name: owner.name, emoji: '👍' },
      ]);
    });

    it('реакция на фигуру отклоняется — только стикеры (12.12)', async () => {
      const owner = await newUser('react-shape-owner');
      const boardId = await newBoard(owner);
      const client = connect(owner);
      await joinBoard(client, boardId);
      const shape = stickyItem({ content: { type: 'shape', shape: 'rectangle', text: '' } });
      await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item: shape }],
      });

      const ack = await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.react', clientOpId: 'c2', id: shape.id, emoji: '👍' }],
      });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error).toBe('bad_request');
    });
  });

  describe('догон по revision', () => {
    it('повторный вход с sinceRevision получает только операции после неё', async () => {
      const owner = await newUser('catchup-owner');
      const boardId = await newBoard(owner);
      const firstClient = connect(owner);
      const initial = await joinBoard(firstClient, boardId);
      expect(initial.revision).toBe(0);

      await emit<ApplyBoardOpsResult>(firstClient, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item: stickyItem() }],
      });

      const secondClient = connect(owner);
      const result = await joinBoard(secondClient, boardId, initial.revision);

      expect(result.snapshot).toBeNull();
      expect(result.catchup).not.toBeNull();
      expect(result.catchup).toHaveLength(1);
      expect(result.revision).toBe(1);
    });
  });

  describe('presence', () => {
    it('рассылает список зрителей при входе и выходе', async () => {
      const owner = await newUser('presence-owner');
      const second = await newUser('presence-second');
      const teamId = await newTeam(owner, [[second, 'member']]);
      const boardId = await newBoard(owner, teamId);
      const firstClient = connect(owner);
      await joinBoard(firstClient, boardId);

      const presencePromise = waitFor<BoardPresenceEntry[]>(
        firstClient,
        BOARD_WS_SERVER_EVENTS.PRESENCE,
      );
      const secondClient = connect(second);
      await joinBoard(secondClient, boardId);
      const entries = await presencePromise;

      expect(entries.map((e) => e.userId).sort()).toEqual([owner.id, second.id].sort());

      const leavePromise = waitFor<BoardPresenceEntry[]>(
        firstClient,
        BOARD_WS_SERVER_EVENTS.PRESENCE,
      );
      secondClient.close();
      const afterLeave = await leavePromise;

      expect(afterLeave.map((e) => e.userId)).toEqual([owner.id]);
    });
  });

  describe('awareness', () => {
    it('ретранслируется остальным участникам, но не самому отправителю', async () => {
      const owner = await newUser('awareness-owner');
      const boardId = await newBoard(owner);
      const senderClient = connect(owner);
      const viewerClient = connect(owner);
      await joinBoard(senderClient, boardId);
      await joinBoard(viewerClient, boardId);

      let receivedBySender = false;
      senderClient.once(BOARD_WS_SERVER_EVENTS.AWARENESS, () => {
        receivedBySender = true;
      });
      const awarenessPromise = waitFor<{ kind: string }>(
        viewerClient,
        BOARD_WS_SERVER_EVENTS.AWARENESS,
      );
      senderClient.emit(BOARD_WS_EVENTS.AWARENESS, { kind: 'cursor', data: { x: 1, y: 2 } });
      const received = await awarenessPromise;

      expect(received.kind).toBe('cursor');
      expect(receivedBySender).toBe(false);
    });

    it('ретранслирует avatarUrl участника вместе с курсором', async () => {
      const owner = await newUser('awareness-avatar');
      const boardId = await newBoard(owner);
      const senderClient = connect(owner);
      const viewerClient = connect(owner);
      await joinBoard(senderClient, boardId);
      await joinBoard(viewerClient, boardId);

      const awarenessPromise = waitFor<{ userId: string; avatarUrl: string | null }>(
        viewerClient,
        BOARD_WS_SERVER_EVENTS.AWARENESS,
      );
      senderClient.emit(BOARD_WS_EVENTS.AWARENESS, {
        kind: 'cursor',
        data: { x: 10, y: 20 },
      });
      const received = await awarenessPromise;

      // avatarUrl должен прилететь отправителю — клиент использует его
      // для цвета курсора (14.1)
      expect(received.userId).toBe(owner.id);
      expect(received.avatarUrl).toBeNull();
    });
  });
});
