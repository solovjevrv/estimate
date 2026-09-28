import type { BoardSnapshot, BoardSummary } from '@estimate/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const getBoard = vi.fn();
const publishBoardThumbnail = vi.fn();
const renderBoardThumbnail = vi.fn();

vi.mock('../src/features/boards/api/boards-api', () => ({
  getBoard: (id: string) => getBoard(id),
  publishBoardThumbnail: (id: string, revision: number, image: Blob) =>
    publishBoardThumbnail(id, revision, image),
}));
vi.mock('../src/features/boards/board-thumbnail-renderer', () => ({
  renderBoardThumbnail: (snapshot: BoardSnapshot) => renderBoardThumbnail(snapshot),
}));

const { useBoardThumbnailQueue } =
  await import('../src/features/boards/composables/use-board-thumbnail-queue');

function board(id: string, over: Partial<BoardSummary> = {}): BoardSummary {
  return {
    id,
    title: id,
    teamId: null,
    ownerId: 'owner',
    status: 'active',
    revision: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    shareRole: null,
    thumbnailUrl: null,
    thumbnailRevision: null,
    itemCount: 2,
    ...over,
  };
}

function snapshotOf(summary: BoardSummary): BoardSnapshot {
  return { board: summary, items: [], edges: [] } as unknown as BoardSnapshot;
}

/** Даёт очереди пройти все await (мок-промисы разрешаются микрозадачами) */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await nextTick();
}

describe('очередь превью досок', () => {
  let scope = effectScope();
  const visible = ref<BoardSummary[]>([]);
  const published: Array<[string, number, string]> = [];

  beforeEach(() => {
    scope = effectScope();
    getBoard.mockImplementation((id: string) =>
      Promise.resolve(snapshotOf(visible.value.find((b) => b.id === id) ?? board(id))),
    );
    renderBoardThumbnail.mockResolvedValue(new Blob(['x'], { type: 'image/webp' }));
    publishBoardThumbnail.mockImplementation((id: string) =>
      Promise.resolve({ updated: true, thumbnailUrl: `/thumb/${id}` }),
    );
  });

  afterEach(() => {
    scope.stop();
    vi.clearAllMocks();
    published.length = 0;
    visible.value = [];
  });

  function start(boards: BoardSummary[]): void {
    visible.value = boards;
    scope.run(() =>
      useBoardThumbnailQueue(visible, (id, revision, url) => published.push([id, revision, url])),
    );
  }

  it('рендерит только устаревшие доски и публикует их по очереди', async () => {
    start([board('a'), board('b', { thumbnailRevision: 3, thumbnailUrl: '/ready' }), board('c')]);
    await settle();

    expect(getBoard.mock.calls.map(([id]) => id)).toEqual(['a', 'c']);
    expect(published).toEqual([
      ['a', 3, '/thumb/a'],
      ['c', 3, '/thumb/c'],
    ]);
  });

  it('пустую доску не рендерит — у неё заглушка', async () => {
    start([board('empty', { itemCount: 0 }), board('a')]);
    await settle();

    expect(getBoard.mock.calls.map(([id]) => id)).toEqual(['a']);
  });

  it('не запускает второй рендер, пока не закончен первый', async () => {
    let finishFirst!: (blob: Blob) => void;
    renderBoardThumbnail.mockImplementationOnce(
      () => new Promise<Blob>((resolve) => (finishFirst = resolve)),
    );
    start([board('a'), board('b')]);
    await settle();

    expect(renderBoardThumbnail).toHaveBeenCalledTimes(1);
    finishFirst(new Blob(['x']));
    await settle();
    expect(renderBoardThumbnail).toHaveBeenCalledTimes(2);
  });

  it('смена страницы отменяет хвост очереди старой страницы', async () => {
    let finishFirst!: (blob: Blob) => void;
    renderBoardThumbnail.mockImplementationOnce(
      () => new Promise<Blob>((resolve) => (finishFirst = resolve)),
    );
    start([board('a'), board('b')]);
    await settle();

    visible.value = [board('z')];
    await settle();
    finishFirst(new Blob(['x']));
    await settle();

    expect(getBoard.mock.calls.map(([id]) => id)).toEqual(['a', 'z']);
    expect(publishBoardThumbnail.mock.calls.map(([id]) => id)).toEqual(['z']);
  });

  it('ошибка одной доски не останавливает очередь и не повторяется после успеха соседей', async () => {
    getBoard.mockImplementation((id: string) =>
      id === 'broken'
        ? Promise.reject(new Error('network'))
        : Promise.resolve(snapshotOf(board(id))),
    );
    start([board('broken'), board('ok')]);
    await settle();
    expect(published.map(([id]) => id)).toEqual(['ok']);

    // Страница применила опубликованное превью — массив новый, очередь перезапустилась
    visible.value = [
      board('broken'),
      board('ok', { thumbnailRevision: 3, thumbnailUrl: '/thumb/ok' }),
    ];
    await settle();

    expect(getBoard.mock.calls.filter(([id]) => id === 'broken')).toHaveLength(1);
  });

  it('доска изменилась с момента загрузки списка — снимок не публикуется', async () => {
    getBoard.mockResolvedValue(snapshotOf(board('a', { revision: 4 })));
    start([board('a')]);
    await settle();

    expect(renderBoardThumbnail).not.toHaveBeenCalled();
    expect(publishBoardThumbnail).not.toHaveBeenCalled();
  });

  it('превью этой ревизии уже опубликовал другой клиент — берёт готовый url', async () => {
    publishBoardThumbnail.mockResolvedValue({ updated: false, thumbnailUrl: '/thumb/other' });
    start([board('a')]);
    await settle();

    expect(published).toEqual([['a', 3, '/thumb/other']]);
  });
});
