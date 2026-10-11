import { BOARD_RING_BUFFER_SIZE, type BoardOpsBatch } from '@estimate/shared';

import { MemoryRealtimeStore, type RealtimeStore } from '../platform/realtime';

/**
 * Последние батчи операций доски — для догона по `sinceRevision` после
 * реконнекта (12.4). Живёт в `RealtimeStore` (10.18): клиент может вернуться
 * на другой экземпляр сервера, чем тот, что применял операции.
 *
 * Батчи с разных экземпляров попадают сюда после коммита и в произвольном
 * порядке — поэтому догон отдаётся, только если ревизии подряд, без дыр, до
 * текущей ревизии доски из БД. Иначе вызывающий код отдаёт полный снимок:
 * лишний снимок дешевле тихо потерянной операции.
 */
export class BoardOpsLog {
  constructor(
    private readonly store: RealtimeStore = new MemoryRealtimeStore(),
    private readonly capacity = BOARD_RING_BUFFER_SIZE,
  ) {}

  async push(boardId: string, batch: BoardOpsBatch): Promise<void> {
    await this.store.sortedAdd(
      this.key(boardId),
      batch.revision,
      JSON.stringify(batch),
      this.capacity,
    );
  }

  /**
   * Батчи после `sinceRevision` до `currentRevision` включительно — или `null`,
   * если буфер не закрывает разрыв целиком. `currentRevision` читается из БД
   * ПОСЛЕ входа сокета в канал доски: всё более позднее он получит рассылкой.
   */
  async catchup(
    boardId: string,
    sinceRevision: number,
    currentRevision: number,
  ): Promise<BoardOpsBatch[] | null> {
    if (sinceRevision > currentRevision) return null;
    if (sinceRevision === currentRevision) return [];
    const stored = await this.store.sortedAbove(this.key(boardId), sinceRevision);
    const batches: BoardOpsBatch[] = [];
    for (const { score, member } of stored) {
      if (score > currentRevision) break;
      // Дыра: батч с этой ревизией ещё не записан или уже вытеснен
      if (score !== sinceRevision + batches.length + 1) return null;
      batches.push(JSON.parse(member) as BoardOpsBatch);
    }
    return batches.length === currentRevision - sinceRevision ? batches : null;
  }

  async clear(boardId: string): Promise<void> {
    await this.store.delete(this.key(boardId));
  }

  /** Ключ в хранилище — для атомарной очистки опустевшей доски */
  key(boardId: string): string {
    return `board-ops:${boardId}`;
  }
}
