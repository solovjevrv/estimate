/**
 * Очередь задач на сокет: следующая начинается только после предыдущей.
 *
 * Вход в комнату или на доску асинхронный (проверка доступа идёт в БД), и
 * два входа одного сокета без очереди могли завершиться в обратном порядке:
 * поздний ответ старого входа пересаживал сокет обратно, и следующие действия
 * уходили не туда, куда смотрит пользователь. С очередью входы выполняются в
 * порядке прихода — сокет оказывается там, куда клиент вошёл последним.
 */
export class PerSocketQueue {
  private readonly tails = new WeakMap<object, Promise<unknown>>();

  run<T>(socket: object, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(socket) ?? Promise.resolve();
    // Отказ предыдущей задачи не отменяет следующую
    const current = previous.then(task, task);
    this.tails.set(
      socket,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }
}
