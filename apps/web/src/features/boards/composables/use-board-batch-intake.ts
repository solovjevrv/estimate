import type { BoardOpsBatch } from '@estimate/shared';

export type BatchApplyResult = 'applied' | 'stale' | 'gap';

export interface BoardBatchIntakeOptions {
  /** Применить батч поверх текущей ревизии (см. `useBoardOptimisticApply.applyBatch`) */
  apply(batch: BoardOpsBatch): BatchApplyResult;
  /** Перезайти на доску с текущей ревизии — за догоном или полным снимком */
  resync(): Promise<void>;
}

/**
 * Приём рассылки `board:ops` (10.18). Две защиты от тихой потери операций:
 *
 * - Пока вход (join) в полёте, батчи копятся и применяются ПОСЛЕ снимка или
 *   догона. Сокет попадает в канал доски раньше, чем приходит ответ на вход, —
 *   применённый сразу батч обогнал бы снимок: снимок откатил бы его, а догон
 *   отбросил бы свои батчи как «уже виденные».
 * - Дыра в ревизиях (рассылка потерялась, например, при сбое Redis) —
 *   перезаход за догоном. Иначе пропущенная операция не вернулась бы никогда.
 *
 * Отложенное принадлежит одной доске: смена доски или выход (`reset`)
 * начинает новую эпоху — входы, начатые до неё, своё отложенное уже не
 * проиграют, даже если завершатся позже входа на новую доску. Батчи чужой
 * доски сюда вообще не попадают — их отсекает стор по `boardId`.
 */
export function useBoardBatchIntake(options: BoardBatchIntakeOptions) {
  let epoch = 0;
  let joinsInFlight = 0;
  let deferred: BoardOpsBatch[] = [];
  let resyncing = false;

  function requestResync(): void {
    if (resyncing) return;
    resyncing = true;
    void options
      .resync()
      .catch(() => {
        // Перезаход не удался (соединение рвётся) — следующий реконнект зайдёт сам
      })
      .finally(() => {
        resyncing = false;
      });
  }

  function receive(batch: BoardOpsBatch): void {
    if (joinsInFlight > 0) {
      deferred.push(batch);
      return;
    }
    if (options.apply(batch) === 'gap') requestResync();
  }

  /** Возвращает метку входа — её передают в `joinFinished` */
  function joinStarted(): number {
    joinsInFlight += 1;
    return epoch;
  }

  /** `applied` — вход дошёл до снимка/догона; иначе отложенное относится к чужому состоянию */
  function joinFinished(startedIn: number, applied: boolean): void {
    // Вход прежней доски (или до выхода) — к текущему отложенному отношения не имеет
    if (startedIn !== epoch) return;
    joinsInFlight = Math.max(0, joinsInFlight - 1);
    if (joinsInFlight > 0) return;
    const batches = deferred.sort((a, b) => a.revision - b.revision);
    deferred = [];
    if (!applied) return;
    for (const batch of batches) {
      if (options.apply(batch) === 'gap') {
        requestResync();
        return;
      }
    }
  }

  /** Смена доски или выход: новая эпоха, всё отложенное и висящие входы — в прошлом */
  function reset(): void {
    epoch += 1;
    joinsInFlight = 0;
    deferred = [];
  }

  return { receive, joinStarted, joinFinished, reset };
}
