import type { Room, RoomRole } from '@poker/shared';

import { TeamAccess } from '../access';
import type { DbExecutor } from '../common/db-executor';
import type { Db } from '../db';
import { ConflictError, NotFoundError } from '../errors';

import { resolveRoomRole } from './rooms.policy';
import { type DbExecutor as RoomsDbExecutor, RoomsRepository } from './rooms.repository';

/**
 * Общая для CRUD- и игровой части комнаты инфраструктура: блокировка строки
 * комнаты под транзакцией и разрешение роли участника. Обе части сервиса
 * держат один и тот же протокол — иначе разошлись бы гарантии, которые он даёт
 * (см. класс-владельца до разделения, 16.5).
 */
export class RoomsTransactions {
  constructor(
    private readonly db: Db,
    private readonly teams: TeamAccess,
    private readonly createRoomsRepository: (executor: RoomsDbExecutor) => RoomsRepository = (
      executor,
    ) => new RoomsRepository(executor),
    private readonly createTeamAccess: (executor: DbExecutor) => TeamAccess = (executor) =>
      TeamAccess.forExecutor(executor),
  ) {}

  /**
   * Роль в комнате: создатель — скрам-мастер, а для командных комнат
   * им же считается администратор команды.
   */
  async resolveRole(
    room: Room,
    userId: string | null,
    teams: TeamAccess = this.teams,
  ): Promise<RoomRole> {
    const teamRole =
      room.teamId && userId && room.creatorId !== userId
        ? ((await teams.membershipOf(room.teamId, userId))?.role ?? null)
        : null;
    return resolveRoomRole(room.creatorId, userId, teamRole);
  }

  /**
   * Комната под блокировкой строки, без проверки архивности — её решает вызывающий
   * (у архивации и удаления архивной комнаты разные требования к этому флагу).
   *
   * Репозиторий команд тоже берётся от транзакции: иначе действие, уже
   * державшее соединение пула, просило бы из него второе — и при полном пуле
   * стол вставал бы намертво.
   */
  async withLockedRoom<T>(
    roomId: string,
    action: (repo: RoomsRepository, room: Room, teams: TeamAccess) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const repo = this.createRoomsRepository(tx);
      const room = await repo.lockRoom(roomId);
      if (!room) {
        throw new NotFoundError('Комната не найдена');
      }
      return action(repo, room, this.createTeamAccess(tx));
    });
  }

  /**
   * Действие над столом под блокировкой комнаты. Все изменения раундов и
   * голосов идут через неё, поэтому выполняются строго по очереди — так снята
   * гонка между голосованием, вскрытием карт и сменой раунда. Архивная комната
   * доступна только для чтения — сюда так не попасть.
   */
  async inRoom<T>(
    roomId: string,
    action: (repo: RoomsRepository, room: Room, teams: TeamAccess) => Promise<T>,
  ): Promise<T> {
    return this.withLockedRoom(roomId, async (repo, room, teams) => {
      if (room.archivedAt) {
        throw new ConflictError('Комната в архиве');
      }
      return action(repo, room, teams);
    });
  }

  /**
   * Снимок без блокировки строки: consistent read внутри одной транзакции,
   * а не эксклюзивная блокировка — читатели снимка не должны ждать друг друга
   * или действия за столом.
   */
  async readSnapshot<T>(action: (repo: RoomsRepository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => action(this.createRoomsRepository(tx)), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
  }
}
