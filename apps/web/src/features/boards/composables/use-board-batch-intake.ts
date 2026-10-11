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
 */
export function useBoardBatchIntake(options: BoardBatchIntakeOptions) {
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

  function joinStarted(): void {
    joinsInFlight += 1;
  }

  /** `applied` — вход дошёл до снимка/догона; иначе отложенное относится к чужому состоянию */
  function joinFinished(applied: boolean): void {
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

  /** Выход с доски: отложенное больше не нужно */
  function reset(): void {
    deferred = [];
  }

  return { receive, joinStarted, joinFinished, reset };
}
