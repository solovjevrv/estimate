/** Минимум, который реестру нужно знать о личности: по нему схлопываются вкладки одного человека */
export interface PresenceIdentity {
  /** Публичный идентификатор участника: id аккаунта либо сессионный id гостя */
  participantId: string;
}

/** Где сидит сокет и кто он — хранится на самом сокете (`socket.data`) */
export interface PresenceSeat<TIdentity> {
  scopeId: string;
  identity: TIdentity;
}

/** Как прочитать и записать место в `socket.data`: у комнат и досок свои поля */
export interface PresenceSeatAccess<TData, TIdentity> {
  read(data: TData): PresenceSeat<TIdentity> | undefined;
  write(data: TData, seat: PresenceSeat<TIdentity> | undefined): void;
}

/** Ровно то, что нужно от сокета Socket.io — локального или удалённого */
interface SocketLike<TData> {
  id: string;
  data: TData;
}

/** `io` с адаптером: `fetchSockets` опрашивает все экземпляры сервера */
export interface PresenceServer<TData> {
  in(room: string): { fetchSockets(): Promise<SocketLike<TData>[]> };
}

/**
 * Кто сейчас подключён к сущности (`scopeId` — комната или доска), по всем
 * экземплярам сервера (10.18).
 *
 * Своё место сокет носит в `socket.data` — сокет живёт на одном экземпляре,
 * поэтому «где я и кто я» отвечается локально и без запросов. Список
 * участников собирается через `fetchSockets()` по каналу сущности: с
 * Redis-адаптером это опрос всех экземпляров, без него — локальный список.
 * Отдельного реестра нет: упавший экземпляр уносит свои сокеты из списка сам,
 * а сокет, выведенный из канала (`socketsLeave` при потере доступа), сразу
 * пропадает из присутствия.
 */
export class ClusterPresence<TIdentity extends PresenceIdentity, TData> {
  constructor(private readonly access: PresenceSeatAccess<TData, TIdentity>) {}

  seatOf(socket: { data: TData }): PresenceSeat<TIdentity> | null {
    return this.access.read(socket.data) ?? null;
  }

  sit(socket: { data: TData }, scopeId: string, identity: TIdentity): void {
    this.access.write(socket.data, { scopeId, identity });
  }

  stand(socket: { data: TData }): void {
    this.access.write(socket.data, undefined);
  }

  /** Все сокеты сущности со своими личностями — по всем экземплярам */
  async members(
    server: PresenceServer<TData>,
    scopeId: string,
  ): Promise<Array<{ socketId: string; identity: TIdentity }>> {
    const sockets = await server.in(scopeId).fetchSockets();
    const members: Array<{ socketId: string; identity: TIdentity }> = [];
    for (const socket of sockets) {
      const seat = this.access.read(socket.data);
      // В канале сущности, но место уже другое — сокет как раз пересаживается
      if (seat?.scopeId === scopeId) members.push({ socketId: socket.id, identity: seat.identity });
    }
    return members;
  }

  /**
   * Участники без дублей: один человек мог открыть две вкладки. Схлопывание
   * идёт по `participantId`, а не по `userId`, — у гостей `userId === null`, и
   * по нему все гости слиплись бы в одну запись.
   */
  async list(server: PresenceServer<TData>, scopeId: string): Promise<TIdentity[]> {
    const unique = new Map<string, TIdentity>();
    for (const { identity } of await this.members(server, scopeId)) {
      unique.set(identity.participantId, identity);
    }
    return [...unique.values()];
  }
}
