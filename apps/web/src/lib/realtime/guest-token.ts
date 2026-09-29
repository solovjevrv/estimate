/**
 * Токен гостя переживает перезагрузку страницы: без него участник вернётся
 * новым человеком и потеряет своё место — за столом вместе с уже отданным
 * голосом, на доске вместе со своей presence-личностью.
 *
 * Хранится по сущности отдельно и с доменным префиксом: токен одной комнаты в
 * другой не подойдёт (сервер проверяет привязку), а комнаты и доски не должны
 * перетирать записи друг друга.
 */
export class GuestTokenStore {
  constructor(private readonly prefix: string) {}

  read(scopeId: string): string | undefined {
    try {
      return localStorage.getItem(this.key(scopeId)) ?? undefined;
    } catch {
      // Приватный режим браузера может запрещать хранилище — тогда просто входим заново
      return undefined;
    }
  }

  /** `null` — сервер токена не выдал (вошёл авторизованный пользователь), сохранять нечего */
  write(scopeId: string, token: string | null): void {
    if (token === null) {
      return;
    }
    try {
      localStorage.setItem(this.key(scopeId), token);
    } catch {
      // Не смогли сохранить — переподключение потребует ввести имя ещё раз
    }
  }

  private key(scopeId: string): string {
    return `${this.prefix}${scopeId}`;
  }
}
