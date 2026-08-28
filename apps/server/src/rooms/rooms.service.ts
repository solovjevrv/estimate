import {
  ROOM_NAME_MAX_LENGTH,
  type Room,
  type RoomStats,
  type RoundHistoryEntry,
} from '@estimate/shared';

import { TeamAccess } from '../access';
import type { Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';

import { normalizeRoomText } from './rooms-validation';
import { RoomsRepository } from './rooms.repository';
import { RoomsTransactions } from './rooms.transactions';
import { summarizeRound } from './round-scoring';

export interface CreateRoomInput {
  name: string;
  teamId?: string | null;
}

/** Хватает с большим запасом на реальные сценарии; пейджинг пока не нужен */
const ROUND_HISTORY_LIMIT = 50;

/**
 * CRUD и жизненный цикл комнаты (создание, список, архивация, удаление, история
 * раундов, статистика) — то, чем пользуется REST. Правила самого стола (голосование,
 * раунды, вход гостя) — в `RoomsGameService`, они пользуются той же блокировкой
 * комнаты и тем же разрешением роли через общий `RoomsTransactions` (16.5).
 */
export class RoomsService {
  constructor(
    private readonly repository: RoomsRepository,
    private readonly teams: TeamAccess,
    private readonly transactions: RoomsTransactions,
  ) {}

  static forDatabase(db: Db): RoomsService {
    const teams = TeamAccess.forExecutor(db);
    return new RoomsService(new RoomsRepository(db), teams, new RoomsTransactions(db, teams));
  }

  async createRoom(actorId: string, input: CreateRoomInput): Promise<Room> {
    const name = normalizeRoomText(input.name, ROOM_NAME_MAX_LENGTH, 'Название комнаты');
    const teamId = input.teamId ?? null;

    if (teamId) {
      // Комнату от лица команды заводит администратор
      await this.teams.require(
        teamId,
        actorId,
        'admin',
        'Создавать комнаты команды может администратор',
      );
    }

    return this.repository.insertRoom(name, teamId, actorId);
  }

  /** Комната открыта по прямой ссылке — отдельных прав на просмотр нет */
  async getRoom(roomId: string): Promise<Room> {
    const room = await this.repository.findRoom(roomId);
    if (!room) {
      throw new NotFoundError('Комната не найдена');
    }
    return room;
  }

  async listTeamRooms(actorId: string, teamId: string, archived = false): Promise<Room[]> {
    // Обычный список открыт любому участнику команды, архив — только администратору.
    // `guest` — младшая роль, на этой ветке проверка сводится к самому членству
    // и текстом про архив ответить не может.
    await this.teams.require(
      teamId,
      actorId,
      archived ? 'admin' : 'guest',
      'Архив комнат команды видит только администратор',
    );
    return this.repository.listRoomsByTeam(teamId, archived);
  }

  /** И личные комнаты, и командные — всё, что пользователь создал сам */
  async listMyRooms(actorId: string, archived = false): Promise<Room[]> {
    return this.repository.listRoomsCreatedBy(actorId, archived);
  }

  /**
   * История вскрытых раундов комнаты с их итогами — комната открыта по прямой
   * ссылке, поэтому доступна так же, как и сама комната (без проверки роли).
   */
  async listRoundHistory(roomId: string): Promise<RoundHistoryEntry[]> {
    await this.getRoom(roomId);
    const rounds = await this.repository.listRevealedRounds(roomId, ROUND_HISTORY_LIMIT);
    const votesByRound = await this.repository.listVotesForRounds(rounds.map((round) => round.id));
    // Раунд без единого голоса при вскрытии невозможен (revealCards это проверяет),
    // но со временем голос мог уйти каскадом вместе с удалённым аккаунтом (7.10) —
    // summarize() на пустом массиве даёт NaN/Infinity, такой раунд лучше пропустить
    return rounds.flatMap((round) => {
      const votes = votesByRound.get(round.id) ?? [];
      return votes.length === 0
        ? []
        : [{ round, result: summarizeRound(votes, round.deckType, round.average) }];
    });
  }

  /** Раундов сыграно, задач оценено и среднее время раунда — по всем комнатам пользователя */
  async getMyStats(actorId: string): Promise<RoomStats> {
    return this.repository.roomStats(actorId);
  }

  /**
   * Архивация — единственный способ «убрать» комнату из основных списков. Настоящее
   * удаление доступно отдельным действием и только для уже заархивированной комнаты.
   *
   * Роль проверяется под той же блокировкой строки комнаты, что и мутация — иначе
   * между чтением роли и записью успело бы пройти чужое понижение/исключение из
   * команды, и запрос выполнился бы уже от имени бывшего администратора.
   */
  async archiveRoom(actorId: string, roomId: string): Promise<Room> {
    return this.transactions.withLockedRoom(roomId, async (repo, room, teams) => {
      if ((await this.transactions.resolveRole(room, actorId, teams)) !== 'scrum_master') {
        throw new ForbiddenError('Архивировать комнату может только скрам-мастер');
      }
      if (room.archivedAt) {
        throw new ConflictError('Комната уже в архиве');
      }
      const archived = await repo.archiveRoom(roomId);
      if (!archived) {
        throw new ConflictError('Комната уже в архиве');
      }
      return archived;
    });
  }

  /**
   * Переименование — как и архивация, доступно только скрам-мастеру. В отличие
   * от голосования, метаданные комнаты можно поправить и после архивации
   * (например, задним числом уточнить название задачи в истории).
   */
  async renameRoom(actorId: string, roomId: string, rawName: string): Promise<Room> {
    const name = normalizeRoomText(rawName, ROOM_NAME_MAX_LENGTH, 'Название комнаты');
    return this.transactions.withLockedRoom(roomId, async (repo, room, teams) => {
      if ((await this.transactions.resolveRole(room, actorId, teams)) !== 'scrum_master') {
        throw new ForbiddenError('Переименовать комнату может только скрам-мастер');
      }
      const updated = await repo.updateRoomName(roomId, name);
      if (!updated) {
        throw new NotFoundError('Комната не найдена');
      }
      return updated;
    });
  }

  /** Необратимо: раунды и голоса комнаты удаляются каскадом на уровне БД */
  async deleteRoomPermanently(actorId: string, roomId: string): Promise<void> {
    await this.transactions.withLockedRoom(roomId, async (repo, room, teams) => {
      if ((await this.transactions.resolveRole(room, actorId, teams)) !== 'scrum_master') {
        throw new ForbiddenError('Удалить комнату может только скрам-мастер');
      }
      if (!room.archivedAt) {
        throw new ConflictError('Сначала заархивируйте комнату');
      }
      const deleted = await repo.deleteArchivedRoom(roomId);
      if (!deleted) {
        throw new NotFoundError('Комната не найдена');
      }
    });
  }
}
