import type { DeckType, Room, Round } from '@poker/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { schema } from '../db';

/** Транзакция Drizzle: тот же интерфейс запросов, что и у соединения */
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbExecutor = Db | Transaction;

/** Голос в текущем раунде вместе с именем голосовавшего */
export interface VoteRecord {
  participantId: string;
  name: string | null;
  value: number;
}

export interface CreateRoundInput {
  roomId: string;
  seq: number;
  deckType: DeckType;
  jiraUrl?: string | null;
  confluenceUrl?: string | null;
}

export class RoomsRepository {
  constructor(private readonly db: DbExecutor) {}

  async insertRoom(name: string, teamId: string | null, creatorId: string): Promise<Room> {
    const [row] = await this.db
      .insert(schema.rooms)
      .values({ name, teamId, creatorId })
      .returning();
    if (!row) {
      throw new Error('Не удалось создать комнату');
    }
    return this.toRoom(row);
  }

  async findRoom(roomId: string): Promise<Room | null> {
    const [row] = await this.db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId));
    return row ? this.toRoom(row) : null;
  }

  /** Комната с блокировкой строки: под ней выполняются смены раундов и вскрытие */
  async lockRoom(roomId: string): Promise<Room | null> {
    const [row] = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .for('update');
    return row ? this.toRoom(row) : null;
  }

  async listRoomsByTeam(teamId: string): Promise<Room[]> {
    const rows = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.teamId, teamId))
      .orderBy(desc(schema.rooms.createdAt));
    return rows.map((row) => this.toRoom(row));
  }

  async closeRoom(roomId: string): Promise<Room | null> {
    const [row] = await this.db
      .update(schema.rooms)
      .set({ status: 'closed' })
      .where(eq(schema.rooms.id, roomId))
      .returning();
    return row ? this.toRoom(row) : null;
  }

  /** Последний по счёту раунд комнаты — он же текущий */
  async findCurrentRound(roomId: string): Promise<Round | null> {
    const [row] = await this.db
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.roomId, roomId))
      .orderBy(desc(schema.rounds.seq))
      .limit(1);
    return row ? this.toRound(row) : null;
  }

  async insertRound(input: CreateRoundInput): Promise<Round> {
    const [row] = await this.db
      .insert(schema.rounds)
      .values({
        roomId: input.roomId,
        seq: input.seq,
        deckType: input.deckType,
        jiraUrl: input.jiraUrl ?? null,
        confluenceUrl: input.confluenceUrl ?? null,
      })
      .returning();
    if (!row) {
      throw new Error('Не удалось создать раунд');
    }
    return this.toRound(row);
  }

  async updateRoundLinks(
    roundId: string,
    links: { jiraUrl?: string | null; confluenceUrl?: string | null },
  ): Promise<Round | null> {
    const patch: Partial<typeof schema.rounds.$inferInsert> = {};
    if (links.jiraUrl !== undefined) patch.jiraUrl = links.jiraUrl;
    if (links.confluenceUrl !== undefined) patch.confluenceUrl = links.confluenceUrl;

    const [row] = await this.db
      .update(schema.rounds)
      .set(patch)
      .where(eq(schema.rounds.id, roundId))
      .returning();
    return row ? this.toRound(row) : null;
  }

  /**
   * Помечает раунд вскрытым. Обновляет только раунд в статусе голосования,
   * поэтому повторное вскрытие ничего не меняет.
   */
  async markRevealed(roundId: string, average: number): Promise<Round | null> {
    const [row] = await this.db
      .update(schema.rounds)
      .set({ status: 'revealed', average: average.toFixed(2), revealedAt: new Date() })
      .where(and(eq(schema.rounds.id, roundId), eq(schema.rounds.status, 'voting')))
      .returning();
    return row ? this.toRound(row) : null;
  }

  /** Голоса раунда вместе с именами: для пользователей — из профиля, для гостей — из голоса */
  async listVotes(roundId: string): Promise<VoteRecord[]> {
    const rows = await this.db
      .select({
        userId: schema.votes.userId,
        guestSessionId: schema.votes.guestSessionId,
        guestName: schema.votes.guestName,
        userName: schema.users.name,
        value: schema.votes.value,
        createdAt: schema.votes.createdAt,
      })
      .from(schema.votes)
      .leftJoin(schema.users, eq(schema.users.id, schema.votes.userId))
      .where(eq(schema.votes.roundId, roundId))
      .orderBy(schema.votes.createdAt);

    return rows.map((row) => ({
      // CHECK-констрейнт гарантирует, что заполнено ровно одно из двух полей
      participantId: row.userId ?? row.guestSessionId ?? 'unknown',
      name: row.userName ?? row.guestName,
      value: row.value,
    }));
  }

  /**
   * Ставит или меняет голос: пока карты не вскрыты, участник может передумать.
   * Частичные уникальные индексы гарантируют один голос на участника.
   */
  async upsertUserVote(roundId: string, userId: string, value: number): Promise<void> {
    await this.db
      .insert(schema.votes)
      .values({ roundId, userId, value })
      .onConflictDoUpdate({
        target: [schema.votes.roundId, schema.votes.userId],
        targetWhere: sql`user_id is not null`,
        set: { value },
      });
  }

  async upsertGuestVote(
    roundId: string,
    guestSessionId: string,
    guestName: string,
    value: number,
  ): Promise<void> {
    await this.db
      .insert(schema.votes)
      .values({ roundId, guestSessionId, guestName, value })
      .onConflictDoUpdate({
        target: [schema.votes.roundId, schema.votes.guestSessionId],
        targetWhere: sql`guest_session_id is not null`,
        set: { value, guestName },
      });
  }

  /** Проверка, что пользователь ещё существует: кука живёт дольше аккаунта */
  async userExists(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return Boolean(row);
  }

  /** Комнаты без команды, созданные пользователем */
  async listPersonalRooms(creatorId: string): Promise<Room[]> {
    const rows = await this.db
      .select()
      .from(schema.rooms)
      .where(and(eq(schema.rooms.creatorId, creatorId), isNull(schema.rooms.teamId)))
      .orderBy(desc(schema.rooms.createdAt));
    return rows.map((row) => this.toRoom(row));
  }

  private toRoom(row: typeof schema.rooms.$inferSelect): Room {
    return {
      id: row.id,
      teamId: row.teamId,
      creatorId: row.creatorId,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toRound(row: typeof schema.rounds.$inferSelect): Round {
    return {
      id: row.id,
      roomId: row.roomId,
      seq: row.seq,
      deckType: row.deckType,
      jiraUrl: row.jiraUrl,
      confluenceUrl: row.confluenceUrl,
      status: row.status,
      average: row.average === null ? null : Number(row.average),
      createdAt: row.createdAt.toISOString(),
      revealedAt: row.revealedAt?.toISOString() ?? null,
    };
  }
}
