import type { BoardSummary } from '@estimate/shared';
import { onScopeDispose, watch, type Ref } from 'vue';

import { getBoard, publishBoardThumbnail } from '../api/boards-api';
import { renderBoardThumbnail } from '../board-thumbnail-renderer';

/**
 * Последовательная очередь снимков для ВИДИМОЙ страницы списка. Не слушает
 * изменения холста: доска помечается устаревшей revision-номером, а работа
 * переносится на следующий заход в «Доски». Новый массив (переключение
 * страницы/вкладки) отменяет оставшийся хвост, уже начатый запрос безопасен —
 * сервер дополнительно сравнит revision под блокировкой строки.
 */
export function useBoardThumbnailQueue(
  visibleBoards: Ref<readonly BoardSummary[]>,
  onPublished: (boardId: string, revision: number, thumbnailUrl: string) => void,
): void {
  let generation = 0;
  /**
   * Ревизии, снимок которых не удался в этом заходе на страницу. Публикация
   * соседней карточки меняет массив и перезапускает очередь — без этого списка
   * сломанная доска перерисовывалась бы после каждого успеха. Новая ревизия
   * (кто-то изменил доску) — новая попытка; следующий заход — тоже.
   */
  const failed = new Set<string>();
  const attemptKey = (board: BoardSummary) => `${board.id}:${board.revision}`;

  watch(
    visibleBoards,
    (boards) => {
      const currentGeneration = ++generation;
      const stale = boards.filter(
        (board) => board.thumbnailRevision !== board.revision && !failed.has(attemptKey(board)),
      );
      void (async () => {
        for (const board of stale) {
          if (currentGeneration !== generation) return;
          try {
            const snapshot = await getBoard(board.id);
            if (currentGeneration !== generation) return;
            if (snapshot.board.revision !== board.revision) continue;
            const image = await renderBoardThumbnail(snapshot);
            if (currentGeneration !== generation) return;
            if (!image) {
              failed.add(attemptKey(board));
              continue;
            }
            const result = await publishBoardThumbnail(board.id, board.revision, image);
            // updated=false с url — превью этой ревизии уже опубликовал другой
            // клиент; оно тоже годится
            if (result.thumbnailUrl) {
              onPublished(board.id, board.revision, result.thumbnailUrl);
            }
          } catch {
            // Список не должен ломаться из-за кэша: на следующем посещении
            // доска снова будет stale и попадёт в очередь.
            failed.add(attemptKey(board));
          }
        }
      })();
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    generation += 1;
  });
}
