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
  BoardEstimateUpdate,
  BoardItem,
  BoardOpsBatch,
  BoardPresenceEntry,
  BoardTimerState,
  BoardVotingState,
  BoardVotingSummary,
  EstimateRoomLink,
  JoinBoardResult,
  WsAck,
} from '@estimate/shared';
import { BOARD_WS_EVENTS, BOARD_WS_SERVER_EVENTS, WS_EVENTS } from '@estimate/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Socket, io as createClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import { ACCESS_COOKIE, TokenService, UsersRepository } from '../src/auth';
import { BoardEstimatesService, BoardsService, BoardVotingService } from '../src/boards';
import type { AuthConfig } from '../src/config';
import { createDb, schema } from '../src/db';
import { RoomsGameService } from '../src/rooms';
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
  const roomIds: string[] = [];
  const clients: Socket[] = [];

  function as(user: AuthUser): { cookie: string } {
    return {
      cookie: `${ACCESS_COOKIE}=${new TokenService(app.jwt, false).issue(user.id, randomUUID()).access}`,
    };
  }

  async function newUser(label: string, avatarUrl: string | null = null): Promise<AuthUser> {
    const id = randomUUID();
    const user = await new UsersRepository(db).upsertFromOAuth('google', {
      providerId: `${label}-${id}`,
      email: `${label}-${id}@example.com`,
      name: `Пользователь ${label}`,
      avatarUrl,
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
    const roomsService = RoomsGameService.forDatabase(db, authConfig.guestSecret);
    const boardsService = BoardsService.forDatabase(db, authConfig.guestSecret);
    new SocketGateway(roomsService, boardsService, {
      corsOrigin: '*',
      boardVoting: new BoardVotingService(db, boardsService),
      boardEstimates: new BoardEstimatesService(db, boardsService),
    }).attach(app);
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

    it('анонимное подключение без куки получает not_found (анти-перебор id)', async () => {
      const owner = await newUser('board-owner-3');
      const boardId = await newBoard(owner);
      const client = connect();

      const ack = await emit<JoinBoardResult>(client, BOARD_WS_EVENTS.JOIN, { boardId });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error).toBe('not_found');
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

    it('снимок несёт имена авторов элементов — для раскладки «по автору» (15.4)', async () => {
      const owner = await newUser('authors-owner');
      const boardId = await newBoard(owner);
      const author = connect(owner);
      await joinBoard(author, boardId);
      await emit<ApplyBoardOpsResult>(author, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'c1', item: stickyItem() }],
      });

      const later = await joinBoard(connect(owner), boardId);

      expect(later.snapshot?.authors).toEqual({ [owner.id]: 'Пользователь authors-owner' });
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
      // Непустой avatarUrl — иначе тест не отличил бы реальную ретрансляцию
      // identity.avatarUrl от захардкоженного null где-нибудь на пути
      const owner = await newUser('awareness-avatar', 'https://example.com/avatar.png');
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
      expect(received.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('блокировка редактирования доходит и посреди потока курсоров (не volatile)', async () => {
      const owner = await newUser('awareness-editing');
      const boardId = await newBoard(owner);
      const senderClient = connect(owner);
      const viewerClient = connect(owner);
      await joinBoard(senderClient, boardId);
      await joinBoard(viewerClient, boardId);

      const editing: unknown[] = [];
      viewerClient.on(
        BOARD_WS_SERVER_EVENTS.AWARENESS,
        (payload: { kind: string; data: unknown }) => {
          if (payload.kind === 'editing') editing.push(payload.data);
        },
      );
      const itemId = randomUUID();
      // Поток курсоров забивает канал до получателя — volatile-события в нём теряются
      for (let i = 0; i < 300; i += 1) {
        senderClient.emit(BOARD_WS_EVENTS.AWARENESS, { kind: 'cursor', data: { x: i, y: i } });
        if (i === 100) {
          senderClient.emit(BOARD_WS_EVENTS.AWARENESS, {
            kind: 'editing',
            data: { itemId, active: true },
          });
        }
      }
      senderClient.emit(BOARD_WS_EVENTS.AWARENESS, {
        kind: 'editing',
        data: { itemId, active: false },
      });

      await vi.waitFor(() =>
        expect(editing).toEqual([
          { itemId, active: true },
          { itemId, active: false },
        ]),
      );
    });

    it('участник без права редактирования не может транслировать курсор (14.7)', async () => {
      const owner = await newUser('awareness-view-owner');
      const guest = await newUser('awareness-view-guest');
      const teamId = await newTeam(owner, [[guest, 'guest']]);
      const boardId = await newBoard(owner, teamId);
      const ownerClient = connect(owner);
      const guestClient = connect(guest);
      await joinBoard(ownerClient, boardId);
      await joinBoard(guestClient, boardId);

      let received = false;
      ownerClient.once(BOARD_WS_SERVER_EVENTS.AWARENESS, () => {
        received = true;
      });
      guestClient.emit(BOARD_WS_EVENTS.AWARENESS, { kind: 'cursor', data: { x: 1, y: 2 } });
      // Барьер вместо произвольной паузы: следующее событие того же сокета с ack
      // гарантированно обработано сервером после awareness — порядок доставки
      // для одного сокета сохраняется
      await joinBoard(guestClient, boardId);

      expect(received).toBe(false);
    });
  });

  describe('таймер доски (15.3)', () => {
    it('при входе приходит таймер по умолчанию: 5 минут, не запущен', async () => {
      const owner = await newUser('timer-join');
      const boardId = await newBoard(owner);

      const result = await joinBoard(connect(owner), boardId);

      expect(result.timer).toEqual({
        durationSec: 300,
        running: false,
        endsAt: null,
        remainingSec: 300,
      });
    });

    it('старт рассылается всем на доске и возвращается в ack; новый вход видит запущенный', async () => {
      const owner = await newUser('timer-owner');
      const member = await newUser('timer-member');
      const teamId = await newTeam(owner, [[member, 'member']]);
      const boardId = await newBoard(owner, teamId);
      const ownerClient = connect(owner);
      const memberClient = connect(member);
      await joinBoard(ownerClient, boardId);
      await joinBoard(memberClient, boardId);

      const broadcast = waitFor<BoardTimerState>(ownerClient, BOARD_WS_SERVER_EVENTS.TIMER);
      const reset = await emit<BoardTimerState>(memberClient, BOARD_WS_EVENTS.TIMER_RESET, {
        durationSec: 1800,
      });
      expect(reset.ok && reset.data.durationSec).toBe(1800);
      expect((await broadcast).durationSec).toBe(1800);

      const startedBroadcast = waitFor<BoardTimerState>(ownerClient, BOARD_WS_SERVER_EVENTS.TIMER);
      const started = await emit<BoardTimerState>(memberClient, BOARD_WS_EVENTS.TIMER_START);
      expect(started.ok && started.data.running).toBe(true);
      expect((await startedBroadcast).endsAt).not.toBeNull();

      const late = await joinBoard(connect(owner), boardId);
      expect(late.timer.running).toBe(true);
      expect(late.timer.durationSec).toBe(1800);
    });

    it('«+1 мин» добавляет минуту к остатку, пауза его фиксирует', async () => {
      const owner = await newUser('timer-extend');
      const boardId = await newBoard(owner);
      const client = connect(owner);
      await joinBoard(client, boardId);

      await emit<BoardTimerState>(client, BOARD_WS_EVENTS.TIMER_START);
      await emit<BoardTimerState>(client, BOARD_WS_EVENTS.TIMER_EXTEND);
      const paused = await emit<BoardTimerState>(client, BOARD_WS_EVENTS.TIMER_PAUSE);

      expect(paused.ok).toBe(true);
      if (paused.ok) {
        expect(paused.data.running).toBe(false);
        // 5:00 + 1:00 минус доли секунды на обмен событиями
        expect(paused.data.remainingSec).toBeGreaterThanOrEqual(359);
        expect(paused.data.remainingSec).toBeLessThanOrEqual(360);
        expect(paused.data.durationSec).toBe(300);
      }
    });

    it('недопустимая длительность отклоняется без рассылки', async () => {
      const owner = await newUser('timer-invalid');
      const boardId = await newBoard(owner);
      const client = connect(owner);
      await joinBoard(client, boardId);

      for (const durationSec of [0, 30, 90, 7260, '300']) {
        const ack = await emit<BoardTimerState>(client, BOARD_WS_EVENTS.TIMER_RESET, {
          durationSec,
        });
        expect(ack.ok).toBe(false);
        if (!ack.ok) expect(ack.error).toBe('bad_request');
      }
    });

    it('участник с доступом view управлять таймером не может', async () => {
      const owner = await newUser('timer-view-owner');
      const guest = await newUser('timer-view-guest');
      const teamId = await newTeam(owner, [[guest, 'guest']]);
      const boardId = await newBoard(owner, teamId);
      const ownerClient = connect(owner);
      const guestClient = connect(guest);
      await joinBoard(ownerClient, boardId);
      const joined = await joinBoard(guestClient, boardId);
      expect(joined.access).toBe('view');

      let broadcast = false;
      ownerClient.once(BOARD_WS_SERVER_EVENTS.TIMER, () => {
        broadcast = true;
      });
      const ack = await emit<BoardTimerState>(guestClient, BOARD_WS_EVENTS.TIMER_START);

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error).toBe('forbidden');
      // Барьер: ack владельца приходит после возможной рассылки отказанного старта
      await joinBoard(ownerClient, boardId);
      expect(broadcast).toBe(false);
    });

    it('команда без входа на доску отклоняется', async () => {
      const owner = await newUser('timer-no-seat');
      const ack = await emit<BoardTimerState>(connect(owner), BOARD_WS_EVENTS.TIMER_START);

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error).toBe('forbidden');
    });

    it('опустевшая доска забывает таймер', async () => {
      const owner = await newUser('timer-empty');
      const boardId = await newBoard(owner);
      const otherBoardId = await newBoard(owner);
      const client = connect(owner);
      await joinBoard(client, boardId);
      await emit<BoardTimerState>(client, BOARD_WS_EVENTS.TIMER_START);

      // Переход на другую доску — первая опустела
      await joinBoard(client, otherBoardId);
      const back = await joinBoard(client, boardId);

      expect(back.timer.running).toBe(false);
      expect(back.timer.remainingSec).toBe(300);
    });
  });

  describe('голосование точками (15.2)', () => {
    async function addItems(
      client: Socket,
      items: Array<Omit<BoardItem, 'boardId' | 'createdBy' | 'updatedAt'>>,
    ): Promise<void> {
      const ack = await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: items.map((item, i) => ({ type: 'item.create', clientOpId: `v${i}`, item })),
      });
      if (!ack.ok) throw new Error(ack.message);
    }

    /**
     * Команда голосования и снимок, который получил `listener`. У отправителя
     * персональная рассылка приходит раньше ack (сервер шлёт её до ответа) —
     * берём последнюю до ответа; у другого сокета ждём первую подходящую под
     * `expect`, а не просто первую: на сокете могла остаться рассылка от
     * прошлой команды.
     */
    async function act(
      client: Socket,
      event: string,
      payload: unknown,
      listener: Socket = client,
      expected: (state: BoardVotingState | null) => boolean = () => true,
    ): Promise<{ ack: WsAck<null>; state: BoardVotingState | null }> {
      const received: Array<BoardVotingState | null> = [];
      let notify: (() => void) | null = null;
      const onState = (state: BoardVotingState | null): void => {
        received.push(state);
        notify?.();
      };
      listener.on(BOARD_WS_SERVER_EVENTS.VOTING, onState);
      try {
        const ack = await emit<null>(client, event, payload);
        if (!ack.ok) return { ack, state: null };
        if (listener === client) return { ack, state: received.at(-1) ?? null };
        const deadline = Date.now() + ANSWER_TIMEOUT_MS;
        while (!received.some(expected)) {
          if (Date.now() > deadline) throw new Error(`${event}: нужная рассылка не пришла`);
          await new Promise<void>((resolve) => {
            notify = resolve;
            setTimeout(resolve, 50);
          });
        }
        return { ack, state: received.find(expected) ?? null };
      } finally {
        listener.off(BOARD_WS_SERVER_EVENTS.VOTING, onState);
      }
    }

    async function teamBoard(label: string) {
      const owner = await newUser(`${label}-owner`);
      const viewer = await newUser(`${label}-viewer`);
      const teamId = await newTeam(owner, [[viewer, 'guest']]);
      const boardId = await newBoard(owner, teamId);
      const ownerClient = connect(owner);
      const viewerClient = connect(viewer);
      await joinBoard(ownerClient, boardId);
      await joinBoard(viewerClient, boardId);
      const [a, b, c] = [stickyItem(), stickyItem(), stickyItem()];
      await addItems(ownerClient, [a, b, c]);
      return { owner, viewer, boardId, ownerClient, viewerClient, a, b, c };
    }

    it('запуск рассылается всем, вошедший получает голосование в снимке входа', async () => {
      const { owner, boardId, ownerClient, viewerClient } = await teamBoard('vote-start');

      const { state } = await act(
        ownerClient,
        BOARD_WS_EVENTS.VOTING_START,
        { votesPerParticipant: 3, maxPerItem: 2 },
        viewerClient,
        (state) => state?.status === 'active',
      );

      expect(state).toMatchObject({ status: 'active', votesPerParticipant: 3, myRemaining: 3 });
      const late = await joinBoard(connect(owner), boardId);
      expect(late.voting?.id).toBe(state?.id);
    });

    it('чужие голоса скрыты до завершения, после — итоги с авторами', async () => {
      const { ownerClient, viewerClient, a, b } = await teamBoard('vote-hidden');
      const { state: started } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: 2,
      });
      const votingId = started!.id;

      // Зритель (view) голосовать может
      const { state: mine } = await act(viewerClient, BOARD_WS_EVENTS.VOTING_VOTE, {
        votingId,
        itemId: a.id,
        delta: 1,
      });
      expect(mine?.myVotes).toEqual({ [a.id]: 1 });

      const { state: ownerView } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_VOTE, {
        votingId,
        itemId: b.id,
        delta: 1,
      });
      expect(ownerView?.myVotes).toEqual({ [b.id]: 1 });
      expect(ownerView?.votedCount).toBe(2);
      expect(ownerView?.results).toBeNull();

      const { state: closed } = await act(
        ownerClient,
        BOARD_WS_EVENTS.VOTING_CLOSE,
        { votingId },
        viewerClient,
        (state) => state?.status === 'closed',
      );
      expect(closed?.status).toBe('closed');
      expect(closed?.results?.map((r) => r.itemId).sort()).toEqual([a.id, b.id].sort());
      expect(closed?.results?.find((r) => r.itemId === a.id)?.authors[0]?.name).toBe(
        'Пользователь vote-hidden-viewer',
      );

      // Итоги прошлого голосования остаются доступны из истории
      const history = await emit<BoardVotingSummary[]>(
        viewerClient,
        BOARD_WS_EVENTS.VOTING_HISTORY,
      );
      // Номер — в пределах доски, даже если на других досках голосований много
      expect(history.ok && history.data).toMatchObject([
        { id: votingId, number: 1, totalVotes: 2, voterCount: 2 },
      ]);
      const past = await emit<BoardVotingState>(viewerClient, BOARD_WS_EVENTS.VOTING_RESULTS, {
        votingId,
      });
      expect(past.ok && past.data.results?.length).toBe(2);
    });

    it('лимиты: не больше голосов на человека и на один элемент, минус снимает', async () => {
      const { ownerClient, a, b } = await teamBoard('vote-limits');
      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 2,
        maxPerItem: 1,
      });
      const votingId = state!.id;
      const vote = (itemId: string, delta: 1 | -1) =>
        emit<null>(ownerClient, BOARD_WS_EVENTS.VOTING_VOTE, { votingId, itemId, delta });

      expect((await vote(a.id, 1)).ok).toBe(true);
      const sameItem = await vote(a.id, 1);
      expect(sameItem.ok).toBe(false);
      if (!sameItem.ok) expect(sameItem.error).toBe('conflict');
      expect((await vote(b.id, 1)).ok).toBe(true);

      const third = stickyItem();
      await addItems(ownerClient, [third]);
      const overLimit = await vote(third.id, 1);
      expect(overLimit.ok).toBe(false);

      const { state: after } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_VOTE, {
        votingId,
        itemId: a.id,
        delta: -1,
      });
      expect(after?.myVotes).toEqual({ [b.id]: 1 });
      expect(after?.myRemaining).toBe(1);
    });

    it('зритель не может запускать, завершать и отменять голосование', async () => {
      const { ownerClient, viewerClient } = await teamBoard('vote-rights');

      const start = await emit<null>(viewerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: 3,
      });
      expect(start.ok).toBe(false);
      if (!start.ok) expect(start.error).toBe('forbidden');

      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: 3,
      });
      for (const event of [BOARD_WS_EVENTS.VOTING_CLOSE, BOARD_WS_EVENTS.VOTING_CANCEL]) {
        const ack = await emit<null>(viewerClient, event, { votingId: state!.id });
        expect(ack.ok).toBe(false);
      }
    });

    it('второе голосование на доске не запускается, отмена убирает голосование', async () => {
      const { ownerClient } = await teamBoard('vote-cancel');
      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: 3,
      });

      const again = await emit<null>(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: 3,
      });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error).toBe('conflict');

      const { state: cancelled } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_CANCEL, {
        votingId: state!.id,
      });
      expect(cancelled).toBeNull();
    });

    it('недопустимые параметры отклоняются', async () => {
      const { ownerClient } = await teamBoard('vote-invalid');
      for (const payload of [
        { votesPerParticipant: 0, maxPerItem: 1 },
        { votesPerParticipant: 3, maxPerItem: 21 },
        { votesPerParticipant: 21, maxPerItem: 1 },
        { votesPerParticipant: '3', maxPerItem: 1 },
      ]) {
        const ack = await emit<null>(ownerClient, BOARD_WS_EVENTS.VOTING_START, payload);
        expect(ack.ok).toBe(false);
        if (!ack.ok) expect(ack.error).toBe('bad_request');
      }
    });

    it('скоуп: нетекстовые элементы отбрасываются, за элемент вне скоупа голосовать нельзя', async () => {
      const { ownerClient, a, b } = await teamBoard('vote-scope');
      const emoji = stickyItem({ content: { type: 'emoji', emoji: '👍' } });
      await addItems(ownerClient, [emoji]);

      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: 3,
        itemIds: [a.id, emoji.id],
      });
      expect(state?.itemIds).toEqual([a.id]);

      const outside = await emit<null>(ownerClient, BOARD_WS_EVENTS.VOTING_VOTE, {
        votingId: state!.id,
        itemId: b.id,
        delta: 1,
      });
      expect(outside.ok).toBe(false);

      const onlyEmoji = await emit<null>(ownerClient, BOARD_WS_EVENTS.VOTING_CANCEL, {
        votingId: state!.id,
      });
      expect(onlyEmoji.ok).toBe(true);
      const empty = await emit<null>(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: 3,
        itemIds: [emoji.id],
      });
      expect(empty.ok).toBe(false);
    });

    it('таймер: старт с галочкой перезапускает его, завершение сбрасывает', async () => {
      const { ownerClient } = await teamBoard('vote-timer');
      await emit<BoardTimerState>(ownerClient, BOARD_WS_EVENTS.TIMER_RESET, { durationSec: 60 });

      const started = waitFor<BoardTimerState>(ownerClient, BOARD_WS_SERVER_EVENTS.TIMER);
      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: 3,
        startTimer: true,
      });
      expect((await started).running).toBe(true);

      const reset = waitFor<BoardTimerState>(ownerClient, BOARD_WS_SERVER_EVENTS.TIMER);
      await act(ownerClient, BOARD_WS_EVENTS.VOTING_CLOSE, { votingId: state!.id });
      expect(await reset).toMatchObject({ running: false, remainingSec: 60 });
    });

    it('без галочки таймер голосованием не трогается', async () => {
      const { ownerClient, boardId } = await teamBoard('vote-no-timer');
      await emit<BoardTimerState>(ownerClient, BOARD_WS_EVENTS.TIMER_START);
      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: 3,
      });
      await act(ownerClient, BOARD_WS_EVENTS.VOTING_CANCEL, { votingId: state!.id });

      const joined = await joinBoard(ownerClient, boardId);
      expect(joined.timer.running).toBe(true);
    });

    it('лимит на элемент больше лимита на человека упирается в меньший', async () => {
      const { ownerClient, a } = await teamBoard('vote-effective');
      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 2,
        maxPerItem: 5,
      });
      const vote = () =>
        emit<null>(ownerClient, BOARD_WS_EVENTS.VOTING_VOTE, {
          votingId: state!.id,
          itemId: a.id,
          delta: 1,
        });
      expect((await vote()).ok).toBe(true);
      expect((await vote()).ok).toBe(true);
      expect((await vote()).ok).toBe(false);
    });

    it('без лимита на человека — сколько угодно элементов, по лимиту на каждый', async () => {
      const { ownerClient, a, b, c } = await teamBoard('vote-likes');
      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: null,
        maxPerItem: 1,
      });
      expect(state?.myRemaining).toBeNull();
      const vote = (itemId: string) =>
        emit<null>(ownerClient, BOARD_WS_EVENTS.VOTING_VOTE, {
          votingId: state!.id,
          itemId,
          delta: 1,
        });
      for (const id of [a.id, b.id, c.id]) expect((await vote(id)).ok).toBe(true);
      expect((await vote(a.id)).ok).toBe(false);

      const both = await emit<null>(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: null,
        maxPerItem: null,
      });
      expect(both.ok).toBe(false);
    });

    it('удаление элемента возвращает его голоса голосовавшим', async () => {
      const { ownerClient, a } = await teamBoard('vote-delete');
      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: 3,
      });
      await act(ownerClient, BOARD_WS_EVENTS.VOTING_VOTE, {
        votingId: state!.id,
        itemId: a.id,
        delta: 1,
      });

      const next = waitFor<BoardVotingState | null>(ownerClient, BOARD_WS_SERVER_EVENTS.VOTING);
      await emit<ApplyBoardOpsResult>(ownerClient, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.delete', clientOpId: 'del', id: a.id }],
      });
      const after = await next;

      expect(after?.myVotes).toEqual({});
      expect(after?.myRemaining).toBe(3);

      // Ctrl+Z восстанавливает элемент с тем же id — голоса возвращаются
      const restored = waitFor<BoardVotingState | null>(ownerClient, BOARD_WS_SERVER_EVENTS.VOTING);
      await emit<ApplyBoardOpsResult>(ownerClient, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: 'undo', item: a }],
      });
      expect((await restored)?.myVotes).toEqual({ [a.id]: 1 });
    });

    it('итоги и история не считают голоса удалённых элементов', async () => {
      const { ownerClient, a, b } = await teamBoard('vote-deleted-results');
      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: null,
      });
      for (const itemId of [a.id, b.id]) {
        await act(ownerClient, BOARD_WS_EVENTS.VOTING_VOTE, {
          votingId: state!.id,
          itemId,
          delta: 1,
        });
      }
      await act(ownerClient, BOARD_WS_EVENTS.VOTING_CLOSE, { votingId: state!.id });
      await emit<ApplyBoardOpsResult>(ownerClient, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.delete', clientOpId: 'del', id: a.id }],
      });

      const results = await emit<BoardVotingState>(ownerClient, BOARD_WS_EVENTS.VOTING_RESULTS, {
        votingId: state!.id,
      });
      const history = await emit<BoardVotingSummary[]>(ownerClient, BOARD_WS_EVENTS.VOTING_HISTORY);

      expect(results.ok && results.data.results?.map((row) => row.itemId)).toEqual([b.id]);
      expect(history.ok && history.data[0]?.totalVotes).toBe(1);
    });

    it('завершённое голосование удаляет только тот, кто правит доску', async () => {
      const { ownerClient, viewerClient, a } = await teamBoard('vote-remove');
      const { state } = await act(ownerClient, BOARD_WS_EVENTS.VOTING_START, {
        votesPerParticipant: 3,
        maxPerItem: null,
      });
      await act(ownerClient, BOARD_WS_EVENTS.VOTING_VOTE, {
        votingId: state!.id,
        itemId: a.id,
        delta: 1,
      });
      // Идущее не удаляется — для него есть «Отменить»
      const active = await act(ownerClient, BOARD_WS_EVENTS.VOTING_DELETE, {
        votingId: state!.id,
      });
      expect(active.ack.ok).toBe(false);
      await act(ownerClient, BOARD_WS_EVENTS.VOTING_CLOSE, { votingId: state!.id });

      const denied = await act(viewerClient, BOARD_WS_EVENTS.VOTING_DELETE, {
        votingId: state!.id,
      });
      expect(denied.ack.ok).toBe(false);
      if (!denied.ack.ok) expect(denied.ack.error).toBe('forbidden');

      const { ack, state: after } = await act(
        ownerClient,
        BOARD_WS_EVENTS.VOTING_DELETE,
        { votingId: state!.id },
        viewerClient,
        (next) => next === null,
      );
      const history = await emit<BoardVotingSummary[]>(ownerClient, BOARD_WS_EVENTS.VOTING_HISTORY);

      expect(ack.ok).toBe(true);
      expect(after).toBeNull();
      expect(history.ok && history.data).toEqual([]);
    });
  });
  describe('оценка в покере (15.6)', () => {
    async function addSticky(client: Socket, text: string): Promise<string> {
      const item = stickyItem({ content: { type: 'sticky', text } });
      const ack = await emit<ApplyBoardOpsResult>(client, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: randomUUID(), item }],
      });
      if (!ack.ok) throw new Error(ack.message);
      return item.id;
    }

    async function estimateRooms(
      user: AuthUser,
      boardId: string,
      itemIds: string[],
    ): Promise<{ status: number; rooms: EstimateRoomLink[] }> {
      const res = await app.inject({
        method: 'POST',
        url: `/api/boards/${boardId}/estimate-rooms`,
        headers: as(user),
        payload: { itemIds },
      });
      const rooms =
        res.statusCode === 200 ? (res.json() as { rooms: EstimateRoomLink[] }).rooms : [];
      roomIds.push(...rooms.map((room) => room.roomId));
      return { status: res.statusCode, rooms };
    }

    it('участник с правом правки заводит командные комнаты; повтор — те же, без дублей', async () => {
      const owner = await newUser('estimate-owner');
      const member = await newUser('estimate-member');
      const teamId = await newTeam(owner, [[member, 'member']]);
      const boardId = await newBoard(owner, teamId);
      const author = connect(owner);
      await joinBoard(author, boardId);
      const first = await addSticky(author, 'Экспорт\nдоски в PDF');
      const second = await addSticky(author, 'Вход через Google');
      const badge = waitFor<BoardEstimateUpdate>(author, BOARD_WS_SERVER_EVENTS.ESTIMATE);

      const created = await estimateRooms(member, boardId, [first, second, first]);

      expect(created.status).toBe(200);
      expect(created.rooms.map((room) => [room.itemId, room.created])).toEqual([
        [first, true],
        [second, true],
      ]);
      // Бейдж «♠ —» появляется у всех на доске сразу
      expect((await badge).estimate.value).toBeNull();
      const rooms = await db
        .select()
        .from(schema.rooms)
        .where(
          inArray(
            schema.rooms.id,
            created.rooms.map((room) => room.roomId),
          ),
        );
      expect(
        rooms.map((room) => [room.name, room.teamId, room.creatorId, room.boardId]).sort(),
      ).toEqual([
        ['Вход через Google', teamId, member.id, boardId],
        ['Экспорт доски в PDF', teamId, member.id, boardId],
      ]);

      const again = await estimateRooms(member, boardId, [first]);
      expect(again.rooms).toEqual([
        { itemId: first, roomId: created.rooms[0]!.roomId, created: false },
      ]);

      // Шапка комнаты знает доску, с которой её завели
      const details = await app.inject({
        method: 'GET',
        url: `/api/rooms/${created.rooms[0]!.roomId}`,
      });
      expect(details.json()).toMatchObject({ board: { id: boardId, name: 'Доска для теста' } });
    });

    it('без права правки — 403; чужие и пустые id — 400', async () => {
      const owner = await newUser('estimate-owner-2');
      const guest = await newUser('estimate-guest');
      const teamId = await newTeam(owner, [[guest, 'guest']]);
      const boardId = await newBoard(owner, teamId);
      const author = connect(owner);
      await joinBoard(author, boardId);
      const sticky = await addSticky(author, 'Задача');

      expect((await estimateRooms(guest, boardId, [sticky])).status).toBe(403);
      expect((await estimateRooms(owner, boardId, [randomUUID()])).status).toBe(400);
      // Фигура — не стикер: оценивать нечего
      const shape = stickyItem({ content: { type: 'shape', shape: 'rectangle', text: 'Фигура' } });
      await emit<ApplyBoardOpsResult>(author, BOARD_WS_EVENTS.APPLY, {
        ops: [{ type: 'item.create', clientOpId: randomUUID(), item: shape }],
      });
      expect((await estimateRooms(owner, boardId, [shape.id])).status).toBe(400);
      expect((await estimateRooms(owner, boardId, [])).status).toBe(400);
    });

    it('вскрытие карт в комнате приходит оценкой на доску и отдаётся при входе', async () => {
      const owner = await newUser('estimate-reveal');
      const boardId = await newBoard(owner);
      const board = connect(owner);
      await joinBoard(board, boardId);
      const itemId = await addSticky(board, 'История раундов');
      const [link] = (await estimateRooms(owner, boardId, [itemId])).rooms;
      // Личная доска — личная комната
      const [personal] = await db
        .select({ teamId: schema.rooms.teamId })
        .from(schema.rooms)
        .where(eq(schema.rooms.id, link!.roomId));
      expect(personal?.teamId).toBeNull();

      const room = connect(owner);
      expect((await emit(room, WS_EVENTS.JOIN_ROOM, { roomId: link!.roomId })).ok).toBe(true);
      expect((await emit(room, WS_EVENTS.START_NEW_ROUND, { deckType: 'fibonacci' })).ok).toBe(
        true,
      );
      expect((await emit(room, WS_EVENTS.SUBMIT_VOTE, { value: 8 })).ok).toBe(true);
      // Голос до вскрытия тоже будит рассылку (значение null) — ждём именно оценку
      const estimate = new Promise<BoardEstimateUpdate>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('оценка не пришла')), ANSWER_TIMEOUT_MS);
        board.on(BOARD_WS_SERVER_EVENTS.ESTIMATE, (update: BoardEstimateUpdate) => {
          if (update.estimate.value === null) return;
          clearTimeout(timer);
          resolve(update);
        });
      });
      expect((await emit(room, WS_EVENTS.REVEAL_CARDS, {})).ok).toBe(true);

      expect(await estimate).toEqual({ itemId, estimate: { roomId: link!.roomId, value: '8' } });
      const later = await joinBoard(connect(owner), boardId);
      expect(later.estimates).toEqual({ [itemId]: { roomId: link!.roomId, value: '8' } });
    });
  });
});
