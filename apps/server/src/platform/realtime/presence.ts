/** Минимум, который реестру нужно знать о личности: по нему схлопываются вкладки одного человека */
export interface PresenceIdentity {
  /** Публичный идентификатор участника: id аккаунта либо сессионный id гостя */
  participantId: string;
}

/**
 * Кто сейчас подключён к сущности (`scopeId` — комната или доска).
 *
 * Живёт в памяти процесса: список подключённых сиюминутен, в базе хранятся
 * только раунды, голоса и элементы досок. При нескольких инстансах сюда
 * понадобится общий адаптер (записано в Epic 8, находка `S-11`).
 *
 * Индекс `scopeBySocket` обратный к основному: без него уход сокета требовал бы
 * обхода всех сущностей, а `disconnect` приходит без контекста.
 */
export class PresenceRegistry<TIdentity extends PresenceIdentity> {
  private readonly identitiesByScope = new Map<string, Map<string, TIdentity>>();
  private readonly scopeBySocket = new Map<string, string>();

  /** Сокет живёт ровно в одной сущности: вход в новую сначала выводит из прежней */
  join(scopeId: string, socketId: string, identity: TIdentity): void {
    this.leave(socketId);
    const scope = this.identitiesByScope.get(scopeId) ?? new Map<string, TIdentity>();
    scope.set(socketId, identity);
    this.identitiesByScope.set(scopeId, scope);
    this.scopeBySocket.set(socketId, scopeId);
  }

  /** Возвращает сущность, из которой ушёл сокет, или null — если он никуда не входил */
  leave(socketId: string): string | null {
    const scopeId = this.scopeBySocket.get(socketId);
    if (!scopeId) {
      return null;
    }
    this.scopeBySocket.delete(socketId);
    const scope = this.identitiesByScope.get(scopeId);
    scope?.delete(socketId);
    if (scope && scope.size === 0) {
      // Опустевшая сущность выкидывается целиком: иначе процесс копил бы по
      // пустой Map на каждую когда-либо открытую комнату или доску
      this.identitiesByScope.delete(scopeId);
    }
    return scopeId;
  }

  scopeOf(socketId: string): string | null {
    return this.scopeBySocket.get(socketId) ?? null;
  }

  identityOf(socketId: string): TIdentity | null {
    const scopeId = this.scopeBySocket.get(socketId);
    if (!scopeId) {
      return null;
    }
    return this.identitiesByScope.get(scopeId)?.get(socketId) ?? null;
  }

  /**
   * Участники без дублей: один человек мог открыть две вкладки. Схлопывание
   * идёт по `participantId`, а не по `userId`, — у гостей `userId === null`, и
   * по нему все гости слиплись бы в одну запись.
   */
  list(scopeId: string): TIdentity[] {
    const scope = this.identitiesByScope.get(scopeId);
    if (!scope) {
      return [];
    }
    const unique = new Map<string, TIdentity>();
    for (const identity of scope.values()) {
      unique.set(identity.participantId, identity);
    }
    return [...unique.values()];
  }

  /**
   * Все сокеты участника: один человек мог открыть несколько вкладок, и кик
   * должен убрать его целиком, а не только одну из них.
   */
  socketIdsOf(scopeId: string, participantId: string): string[] {
    const scope = this.identitiesByScope.get(scopeId);
    if (!scope) {
      return [];
    }
    const ids: string[] = [];
    for (const [socketId, identity] of scope) {
      if (identity.participantId === participantId) {
        ids.push(socketId);
      }
    }
    return ids;
  }

  /**
   * Сколько сущностей сейчас держат хотя бы один сокет. Нужно, чтобы
   * освобождение памяти в `leave` было наблюдаемым: без этого утечка пустых
   * записей никак не проявляется снаружи и тихо переживает любой рефакторинг.
   */
  get activeScopes(): number {
    return this.identitiesByScope.size;
  }
}
