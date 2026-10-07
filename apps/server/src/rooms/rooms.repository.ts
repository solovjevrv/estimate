import type { DeckType, Room, RoomDetails, RoomStats, Round } from '@estimate/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import { schema } from '../db';
import type { DbExecutor } from '../common/db-executor';
export type { DbExecutor };

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

  /** Комната вместе с названием её команды (null — личная) и доской, с которой её завели (15.6) */
  async findRoomDetails(roomId: string): Promise<RoomDetails | null> {
    const [row] = await this.db
      .select({
        room: schema.rooms,
        teamName: schema.teams.name,
        boardId: schema.boards.id,
        boardName: schema.boards.title,
      })
      .from(schema.rooms)
      .leftJoin(schema.teams, eq(schema.teams.id, schema.rooms.teamId))
      .leftJoin(schema.boards, eq(schema.boards.id, schema.rooms.boardId))
      .where(eq(schema.rooms.id, roomId));
    if (!row) return null;
    return {
      room: this.toRoom(row.room),
      teamName: row.teamName,
      board: row.boardId && row.boardName ? { id: row.boardId, name: row.boardName } : null,
    };
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

  async listRoomsByTeam(teamId: string, archived = false): Promise<Room[]> {
    const archivedCondition = archived
      ? sql`${schema.rooms.archivedAt} is not null`
      : isNull(schema.rooms.archivedAt);
    const rows = await this.db
      .select()
      .from(schema.rooms)
      .where(and(eq(schema.rooms.teamId, teamId), archivedCondition))
      .orderBy(desc(schema.rooms.createdAt));
    return rows.map((row) => this.toRoom(row));
  }

  /** Помечает комнату архивной: не удаляет, только прячет из основных списков и запрещает действия за столом */
  async archiveRoom(roomId: string): Promise<Room | null> {
    const [row] = await this.db
      .update(schema.rooms)
      .set({ archivedAt: new Date(), revision: sql`${schema.rooms.revision} + 1` })
      .where(and(eq(schema.rooms.id, roomId), isNull(schema.rooms.archivedAt)))
      .returning();
    return row ? this.toRoom(row) : null;
  }

  /** Настоящее удаление: возможно только для уже заархивированной комнаты. Раунды и голоса уходят каскадом */
  async deleteArchivedRoom(roomId: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.rooms)
      .where(and(eq(schema.rooms.id, roomId), sql`${schema.rooms.archivedAt} is not null`))
      .returning({ id: schema.rooms.id });
    return rows.length > 0;
  }

  /** Переименование комнаты — метаданные, доступны и для уже заархивированной комнаты */
  async updateRoomName(roomId: string, name: string): Promise<Room | null> {
    const [row] = await this.db
      .update(schema.rooms)
      .set({ name, revision: sql`${schema.rooms.revision} + 1` })
      .where(eq(schema.rooms.id, roomId))
      .returning();
    return row ? this.toRoom(row) : null;
  }

  /** Отмечает, что за столом что-то изменилось: по этому номеру клиент отбрасывает отставшие рассылки */
  async bumpRevision(roomId: string): Promise<void> {
    await this.db
      .update(schema.rooms)
      .set({ revision: sql`${schema.rooms.revision} + 1` })
      .where(eq(schema.rooms.id, roomId));
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
      })
      .returning();
    if (!row) {
      throw new Error('Не удалось создать раунд');
    }
    return this.toRound(row);
  }

  /**
   * Правит ссылки комнаты и поднимает их версию. Если передана ожидаемая версия,
   * запись пройдёт только пока ссылки никто не менял — иначе вернётся null.
   */
  async updateRoomLinks(
    roomId: string,
    links: { jiraUrl?: string | null; confluenceUrl?: string | null },
    expectedVersion?: number,
  ): Promise<Room | null> {
    const patch: PgUpdateSetSource<typeof schema.rooms> = {
      linksVersion: sql`${schema.rooms.linksVersion} + 1`,
    };
    if (links.jiraUrl !== undefined) patch.jiraUrl = links.jiraUrl;
    if (links.confluenceUrl !== undefined) patch.confluenceUrl = links.confluenceUrl;

    const condition =
      expectedVersion === undefined
        ? eq(schema.rooms.id, roomId)
        : and(eq(schema.rooms.id, roomId), eq(schema.rooms.linksVersion, expectedVersion));

    const [row] = await this.db.update(schema.rooms).set(patch).where(condition).returning();
    return row ? this.toRoom(row) : null;
  }

  /**
   * Помечает раунд вскрытым. Обновляет только раунд в статусе голосования,
   * поэтому повторное вскрытие ничего не меняет.
   */
  async markRevealed(roundId: string, average: number | null): Promise<Round | null> {
    const [row] = await this.db
      .update(schema.rounds)
      .set({
        status: 'revealed',
        average: average === null ? null : average.toFixed(2),
        revealedAt: new Date(),
      })
      .where(and(eq(schema.rounds.id, roundId), eq(schema.rounds.status, 'voting')))
      .returning();
    return row ? this.toRound(row) : null;
  }

  /**
   * Пересчёт среднего уже вскрытого раунда — доголосование/переголосование после
   * вскрытия (20.3.6) продолжает менять состав голосов, а `average` в БД иначе
   * остался бы «замороженным» на момент первого вскрытия (`markRevealed` его
   * специально больше не трогает — обновляет только строки в статусе `voting`).
   */
  async updateRoundAverage(roundId: string, average: number | null): Promise<void> {
    await this.db
      .update(schema.rounds)
      .set({ average: average === null ? null : average.toFixed(2) })
      .where(eq(schema.rounds.id, roundId));
  }

  /** Голоса раунда вместе с именами: для пользователей — из профиля, для гостей — из голоса */
  async listVotes(roundId: string): Promise<VoteRecord[]> {
    const rows = await this.db
      .select({
        userId: schema.votes.userId,
        guestSessionId: schema.votes.guestSessionId,
        guestName: schema.votes.guestName,
        // Провайдер перезаписывает users.name при каждом входе — правка пользователя
        // (9.2) живёт в display_name, поэтому наружу отдаём именно её при наличии
        userName: sql<string | null>`coalesce(${schema.users.displayName}, ${schema.users.name})`,
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
   * Голоса нескольких раундов одним запросом. Массив в каждой группе сохраняет
   * порядок создания голосов — тот же, что у listVotes для одного раунда.
   */
  async listVotesForRounds(roundIds: readonly string[]): Promise<Map<string, VoteRecord[]>> {
    const votesByRound = new Map(roundIds.map((roundId) => [roundId, [] as VoteRecord[]]));
    if (roundIds.length === 0) return votesByRound;

    const rows = await this.db
      .select({
        roundId: schema.votes.roundId,
        userId: schema.votes.userId,
        guestSessionId: schema.votes.guestSessionId,
        guestName: schema.votes.guestName,
        userName: sql<string | null>`coalesce(${schema.users.displayName}, ${schema.users.name})`,
        value: schema.votes.value,
        createdAt: schema.votes.createdAt,
      })
      .from(schema.votes)
      .leftJoin(schema.users, eq(schema.users.id, schema.votes.userId))
      .where(inArray(schema.votes.roundId, roundIds))
      .orderBy(schema.votes.createdAt);

    for (const row of rows) {
      const votes = votesByRound.get(row.roundId);
      if (votes) {
        votes.push({
          participantId: row.userId ?? row.guestSessionId ?? 'unknown',
          name: row.userName ?? row.guestName,
          value: row.value,
        });
      }
    }
    return votesByRound;
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

  /** Вскрытые раунды комнаты, от последнего к первому — для истории на странице комнаты */
  async listRevealedRounds(roomId: string, limit: number): Promise<Round[]> {
    const rows = await this.db
      .select()
      .from(schema.rounds)
      .where(and(eq(schema.rounds.roomId, roomId), eq(schema.rounds.status, 'revealed')))
      .orderBy(desc(schema.rounds.seq))
      .limit(limit);
    return rows.map((row) => this.toRound(row));
  }

  /**
   * Статистика по вскрытым раундам всех комнат создателя (архивным и активным
   * вместе). Задач оценено — комнат хотя бы с одним вскрытым раундом: комната
   * заводится под одну задачу (7.25), поэтому задача = комната.
   */
  async roomStats(creatorId: string): Promise<RoomStats> {
    const [row] = await this.db
      .select({
        roundsPlayed: sql<string>`count(*)`,
        tasksEstimated: sql<string>`count(distinct ${schema.rounds.roomId})`,
        avgRoundDurationSec: sql<
          string | null
        >`avg(extract(epoch from (${schema.rounds.revealedAt} - ${schema.rounds.createdAt})))`,
      })
      .from(schema.rounds)
      .innerJoin(schema.rooms, eq(schema.rooms.id, schema.rounds.roomId))
      .where(and(eq(schema.rooms.creatorId, creatorId), eq(schema.rounds.status, 'revealed')));

    return {
      roundsPlayed: Number(row?.roundsPlayed ?? 0),
      tasksEstimated: Number(row?.tasksEstimated ?? 0),
      avgRoundDurationSec:
        row?.avgRoundDurationSec === null || row?.avgRoundDurationSec === undefined
          ? null
          : Number(row.avgRoundDurationSec),
    };
  }

  /** Все комнаты, которые создал пользователь — личные и командные вместе */
  async listRoomsCreatedBy(creatorId: string, archived = false): Promise<Room[]> {
    const archivedCondition = archived
      ? sql`${schema.rooms.archivedAt} is not null`
      : isNull(schema.rooms.archivedAt);
    const rows = await this.db
      .select()
      .from(schema.rooms)
      .where(and(eq(schema.rooms.creatorId, creatorId), archivedCondition))
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
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
      jiraUrl: row.jiraUrl,
      confluenceUrl: row.confluenceUrl,
      linksVersion: row.linksVersion,
    };
  }

  private toRound(row: typeof schema.rounds.$inferSelect): Round {
    return {
      id: row.id,
      roomId: row.roomId,
      seq: row.seq,
      deckType: row.deckType,
      status: row.status,
      average: row.average === null ? null : Number(row.average),
      createdAt: row.createdAt.toISOString(),
      revealedAt: row.revealedAt?.toISOString() ?? null,
    };
  }
}
