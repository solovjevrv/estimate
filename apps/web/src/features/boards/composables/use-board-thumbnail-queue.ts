import type { BoardSummary } from '@estimate/shared';
import { onScopeDispose, watch, type Ref } from 'vue';

import { getBoard, publishBoardThumbnail } from '../api/boards-api';
import { renderBoardThumbnail } from '../board-thumbnail-renderer';

/**
 * Последовательная очередь снимков для ВИДИМОЙ страницы списка. Не слушает
 * изменения холста: доска помечается устаревшей revision-номером, а работа
 * переносится на следующий заход в «Доски». Новый массив (переключение
 * страницы/вкладки) отменяет оставшийся хвост, уже начатый запрос безопасен —
 * сервер дополнительно сравнит revision в UPDATE.
 */
export function useBoardThumbnailQueue(
  visibleBoards: Ref<readonly BoardSummary[]>,
  onPublished: (boardId: string, revision: number, thumbnailUrl: string) => void,
): void {
  let generation = 0;

  watch(
    visibleBoards,
    (boards) => {
      const currentGeneration = ++generation;
      const stale = boards.filter((board) => board.thumbnailRevision !== board.revision);
      void (async () => {
        for (const board of stale) {
          if (currentGeneration !== generation) return;
          try {
            const snapshot = await getBoard(board.id);
            if (currentGeneration !== generation || snapshot.board.revision !== board.revision) continue;
            const image = await renderBoardThumbnail(snapshot);
            if (!image || currentGeneration !== generation) continue;
            const result = await publishBoardThumbnail(board.id, board.revision, image);
            if (currentGeneration === generation && result.updated && result.thumbnailUrl) {
              onPublished(board.id, board.revision, result.thumbnailUrl);
            }
          } catch {
            // Список не должен ломаться из-за кэша: на следующем посещении
            // доска снова будет stale и попадёт в очередь.
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
