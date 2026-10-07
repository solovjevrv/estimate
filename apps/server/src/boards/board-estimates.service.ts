import {
  BOARD_ESTIMATE_MAX_ITEMS,
  isVotableContent,
  type Board,
  type BoardEstimateUpdate,
  type BoardItemEstimate,
  type EstimateRoomLink,
} from '@estimate/shared';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import type { DbExecutor } from '../common/db-executor';
import type { Db } from '../db';
import * as schema from '../db/schema';
import { ValidationError } from '../errors';

import { estimateLabel, estimateRoomName } from './board-estimates';

/** Живая проверка доступа — её делает `BoardsService`, оценка только вызывает */
export interface BoardEstimatesAccess {
  /** `edit` и доска не в архиве — отправить элементы в покер */
  assertActiveEditAccess(actorId: string | null, boardId: string): Promise<Board>;
}

export interface CreatedEstimateRooms {
  rooms: EstimateRoomLink[];
  /** Новые связи — разослать на доску, чтобы бейдж «♠ —» появился у всех */
  updates: BoardEstimateUpdate[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK_ROOM_NAME = 'Задача с доски';

interface LinkedRoom {
  roomId: string;
  boardId: string;
  itemId: string;
}

/**
 * Связка «доска ↔ покер-комната» (15.6): элемент доски → своя комната, на
 * элементе — оценка последнего вскрытого раунда. Оценка производная и в
 * элемент не пишется: домен комнат не трогает журнал операций доски.
 */
export class BoardEstimatesService {
  constructor(
    private readonly db: Db,
    private readonly access: BoardEstimatesAccess,
  ) {}

  /**
   * Комнаты для элементов: заводит недостающие, уже существующие отдаёт как
   * есть (повторный клик, двойной клик, два человека разом — без дублей).
   * Комната командная, если доска командная, — создаёт её любой с правом
   * правки доски (решение 07.10.2026), он же скрам-мастер.
   */
  async createRooms(
    actorId: string,
    boardId: string,
    rawItemIds: unknown,
  ): Promise<CreatedEstimateRooms> {
    if (
      !Array.isArray(rawItemIds) ||
      rawItemIds.length === 0 ||
      rawItemIds.length > BOARD_ESTIMATE_MAX_ITEMS ||
      !rawItemIds.every((id) => typeof id === 'string' && UUID_RE.test(id))
    ) {
      throw new ValidationError(`Укажите от 1 до ${BOARD_ESTIMATE_MAX_ITEMS} элементов`);
    }
    const itemIds = [...new Set(rawItemIds as string[])];
    const board = await this.access.assertActiveEditAccess(actorId, boardId);

    return this.db.transaction(async (tx) => {
      const items = await tx
        .select({ id: schema.boardItems.id, content: schema.boardItems.content })
        .from(schema.boardItems)
        .where(and(eq(schema.boardItems.boardId, boardId), inArray(schema.boardItems.id, itemIds)));
      const estimable = items.filter((item) => isVotableContent(item.content));
      if (estimable.length === 0) {
        throw new ValidationError('Оценить в покере можно только стикеры');
      }

      const linkedBefore = await this.linkedRooms(
        tx,
        boardId,
        estimable.map((item) => item.id),
      );
      const missing = estimable.filter((item) => !linkedBefore.has(item.id));
      const inserted = missing.length
        ? await tx
            .insert(schema.rooms)
            .values(
              missing.map((item) => ({
                name: estimateRoomName(
                  'text' in item.content ? item.content.text : '',
                  FALLBACK_ROOM_NAME,
                ),
                teamId: board.teamId,
                creatorId: actorId,
                boardId,
                boardItemId: item.id,
              })),
            )
            // Параллельный запрос успел завести комнату тому же элементу — берём его
            .onConflictDoNothing({ target: schema.rooms.boardItemId })
            .returning({ id: schema.rooms.id, itemId: schema.rooms.boardItemId })
        : [];
      const createdIds = new Set(inserted.map((row) => row.id));
      const linked = await this.linkedRooms(
        tx,
        boardId,
        estimable.map((item) => item.id),
      );

      const rooms: EstimateRoomLink[] = [];
      const updates: BoardEstimateUpdate[] = [];
      // В порядке запроса — БД отдаёт элементы в произвольном
      for (const itemId of itemIds) {
        const link = linked.get(itemId);
        if (!link) continue;
        const created = createdIds.has(link.roomId);
        rooms.push({ itemId, roomId: link.roomId, created });
        if (created) updates.push({ itemId, estimate: { roomId: link.roomId, value: null } });
      }
      return { rooms, updates };
    });
  }

  /** Оценки всех элементов доски, у которых есть комната */
  async listForBoard(boardId: string): Promise<Record<string, BoardItemEstimate>> {
    const rooms = await this.db
      .select({ roomId: schema.rooms.id, itemId: schema.rooms.boardItemId })
      .from(schema.rooms)
      .where(and(eq(schema.rooms.boardId, boardId), isNotNull(schema.rooms.boardItemId)));
    const values = await this.valuesFor(rooms.map((room) => room.roomId));
    const estimates: Record<string, BoardItemEstimate> = {};
    for (const room of rooms) {
      if (!room.itemId) continue;
      estimates[room.itemId] = { roomId: room.roomId, value: values.get(room.roomId) ?? null };
    }
    return estimates;
  }

  /** Новая оценка элемента после вскрытия или переголосования в комнате; null — комната не с доски */
  async forRoom(roomId: string): Promise<{ boardId: string; update: BoardEstimateUpdate } | null> {
    const [room] = await this.db
      .select({
        roomId: schema.rooms.id,
        boardId: schema.rooms.boardId,
        itemId: schema.rooms.boardItemId,
      })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId));
    if (!room?.boardId || !room.itemId) return null;
    const values = await this.valuesFor([roomId]);
    return {
      boardId: room.boardId,
      update: { itemId: room.itemId, estimate: { roomId, value: values.get(roomId) ?? null } },
    };
  }

  private async linkedRooms(
    executor: DbExecutor,
    boardId: string,
    itemIds: string[],
  ): Promise<Map<string, LinkedRoom>> {
    const rows = await executor
      .select({ roomId: schema.rooms.id, itemId: schema.rooms.boardItemId })
      .from(schema.rooms)
      .where(and(eq(schema.rooms.boardId, boardId), inArray(schema.rooms.boardItemId, itemIds)));
    return new Map(
      rows
        .filter((row): row is { roomId: string; itemId: string } => row.itemId !== null)
        .map((row) => [row.itemId, { roomId: row.roomId, boardId, itemId: row.itemId }]),
    );
  }

  /** Подпись последнего вскрытого раунда каждой комнаты; комнат без вскрытий в ответе нет */
  private async valuesFor(roomIds: string[]): Promise<Map<string, string>> {
    if (roomIds.length === 0) return new Map();
    const r = schema.rounds;
    const rounds = await this.db
      .selectDistinctOn([r.roomId], {
        id: r.id,
        roomId: r.roomId,
        deckType: r.deckType,
        average: r.average,
      })
      .from(r)
      .where(and(inArray(r.roomId, roomIds), eq(r.status, 'revealed')))
      .orderBy(r.roomId, desc(r.seq));
    // Голоса нужны только футболкам (самый частый размер) — у числовых колод среднее уже в раунде
    const needVotes = rounds
      .filter((round) => round.deckType === 'tshirt' || round.average === null)
      .map((round) => round.id);
    const votes = needVotes.length
      ? await this.db
          .select({ roundId: schema.votes.roundId, value: schema.votes.value })
          .from(schema.votes)
          .where(inArray(schema.votes.roundId, needVotes))
      : [];
    const values = new Map<string, string>();
    for (const round of rounds) {
      const label = estimateLabel(
        round.deckType,
        round.average === null ? null : Number(round.average),
        votes.filter((vote) => vote.roundId === round.id).map((vote) => vote.value),
      );
      if (label !== null) values.set(round.roomId, label);
    }
    return values;
  }
}
