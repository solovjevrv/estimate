import type { Options as HtmlToImageOptions } from 'html-to-image/lib/types';
import { describe, expect, it, vi } from 'vitest';

import { downloadBlob } from '../src/lib/download-file';
import {
  useBoardExport,
  type ExportRect,
} from '../src/features/boards/composables/use-board-export';

vi.mock('../src/lib/download-file', () => ({
  downloadBlob: vi.fn(),
}));

const downloadBlobMock = vi.mocked(downloadBlob);
const identityProject = (point: { x: number; y: number }): { x: number; y: number } => point;
const canvasRect = { left: 0, top: 0 } as DOMRect;

describe('useBoardExport', () => {
  it('itemCount и hasSelection читаются из переданных опций', () => {
    const boardExport = useBoardExport({
      boardTitle: () => 'Доска',
      itemCount: () => 2,
      getViewportEl: () => null,
      getCanvasRect: () => canvasRect,
      project: identityProject,
      getAllNodeIds: () => [],
      getSelectedNodeIds: () => ['a'],
    });

    expect(boardExport.itemCount.value).toBe(2);
    expect(boardExport.hasSelection.value).toBe(true);
  });

  it('hasSelection ложно, если выделения нет', () => {
    const boardExport = useBoardExport({
      boardTitle: () => 'Доска',
      itemCount: () => 0,
      getViewportEl: () => null,
      getCanvasRect: () => canvasRect,
      project: identityProject,
      getAllNodeIds: () => [],
      getSelectedNodeIds: () => [],
    });

    expect(boardExport.hasSelection.value).toBe(false);
  });

  describe('runExport', () => {
    it('применяет transform по границам и отступу, скачивает .png и восстанавливает исходный стиль', async () => {
      downloadBlobMock.mockClear();
      const viewportEl = document.createElement('div');
      viewportEl.style.transform = 'translate(1px, 2px) scale(1)';
      let styleDuringExport: string | null = null;
      const toBlobImpl = vi.fn(async (el: HTMLElement, opts?: HtmlToImageOptions) => {
        styleDuringExport = el.style.transform;
        void opts;
        return new Blob(['png-bytes']);
      });
      const bounds: ExportRect = { x: 10, y: 20, width: 100, height: 80 };

      const boardExport = useBoardExport({
        boardTitle: () => 'Ретро',
        itemCount: () => 1,
        getViewportEl: () => viewportEl,
        getCanvasRect: () => canvasRect,
        project: identityProject,
        getAllNodeIds: () => ['a'],
        getSelectedNodeIds: () => [],
        toBlobImpl,
        measureBounds: () => bounds,
      });

      await boardExport.runExport(false, 24);

      // EXPORT_SCALE = 2: translate = -bounds.{x,y} * 2 + margin
      expect(styleDuringExport).toBe('translate(4px, -16px) scale(2)');
      expect(viewportEl.style.transform).toBe('translate(1px, 2px) scale(1)');
      expect(toBlobImpl).toHaveBeenCalledTimes(1);
      const [, opts] = toBlobImpl.mock.calls[0]!;
      expect(opts).toMatchObject({ width: 248, height: 208, pixelRatio: 1 });
      expect(downloadBlobMock).toHaveBeenCalledTimes(1);
      expect(downloadBlobMock.mock.calls[0]![0].endsWith('.png')).toBe(true);
    });

    it('больший отступ увеличивает итоговое изображение с обеих сторон', async () => {
      const viewportEl = document.createElement('div');
      const toBlobImpl = vi.fn<(el: HTMLElement, opts?: HtmlToImageOptions) => Promise<Blob>>(
        async () => new Blob(['x']),
      );
      const bounds: ExportRect = { x: 0, y: 0, width: 100, height: 100 };

      const boardExport = useBoardExport({
        boardTitle: () => 'Доска',
        itemCount: () => 1,
        getViewportEl: () => viewportEl,
        getCanvasRect: () => canvasRect,
        project: identityProject,
        getAllNodeIds: () => ['a'],
        getSelectedNodeIds: () => [],
        toBlobImpl,
        measureBounds: () => bounds,
      });

      await boardExport.runExport(false, 60);

      const [, opts] = toBlobImpl.mock.calls[0]!;
      // width*2 (scale) + margin*2 = 200 + 120
      expect(opts).toMatchObject({ width: 320, height: 320 });
    });

    it('закрывает модалку и сбрасывает pending после успеха', async () => {
      const viewportEl = document.createElement('div');
      const boardExport = useBoardExport({
        boardTitle: () => 'Доска',
        itemCount: () => 1,
        getViewportEl: () => viewportEl,
        getCanvasRect: () => canvasRect,
        project: identityProject,
        getAllNodeIds: () => ['a'],
        getSelectedNodeIds: () => [],
        toBlobImpl: vi.fn(async () => new Blob(['x'])),
        measureBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      });
      boardExport.open.value = true;

      await boardExport.runExport(false, 24);

      expect(boardExport.pending.value).toBe(false);
      expect(boardExport.open.value).toBe(false);
    });

    it('бросает ошибку и оставляет модалку открытой, если viewport-элемент недоступен', async () => {
      const boardExport = useBoardExport({
        boardTitle: () => 'Доска',
        itemCount: () => 1,
        getViewportEl: () => null,
        getCanvasRect: () => canvasRect,
        project: identityProject,
        getAllNodeIds: () => ['a'],
        getSelectedNodeIds: () => [],
      });
      boardExport.open.value = true;

      await expect(boardExport.runExport(false, 24)).rejects.toThrow();

      expect(boardExport.pending.value).toBe(false);
      expect(boardExport.open.value).toBe(true);
    });

    it('бросает ошибку, если canvas-контейнер недоступен', async () => {
      const boardExport = useBoardExport({
        boardTitle: () => 'Доска',
        itemCount: () => 1,
        getViewportEl: () => document.createElement('div'),
        getCanvasRect: () => undefined,
        project: identityProject,
        getAllNodeIds: () => ['a'],
        getSelectedNodeIds: () => [],
      });

      await expect(boardExport.runExport(false, 24)).rejects.toThrow();
    });

    it('бросает ошибку, если измерение границ не нашло ни одного узла', async () => {
      const boardExport = useBoardExport({
        boardTitle: () => 'Доска',
        itemCount: () => 1,
        getViewportEl: () => document.createElement('div'),
        getCanvasRect: () => canvasRect,
        project: identityProject,
        getAllNodeIds: () => ['a'],
        getSelectedNodeIds: () => [],
        measureBounds: () => null,
      });

      await expect(boardExport.runExport(false, 24)).rejects.toThrow();
    });
  });

  describe('измерение границ по умолчанию (реальный DOM)', () => {
    it('расширяет границы вверх заголовком фрейма (.board-frame-title-bar), а не только geometry узла', async () => {
      const viewportEl = document.createElement('div');
      const nodeEl = document.createElement('div');
      nodeEl.setAttribute('data-node-id', 'frame-1');
      const titleBar = document.createElement('div');
      titleBar.className = 'board-frame-title-bar';
      nodeEl.appendChild(titleBar);
      viewportEl.appendChild(nodeEl);

      vi.spyOn(nodeEl, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 100,
        right: 300,
        bottom: 300,
        width: 200,
        height: 200,
      } as DOMRect);
      // Заголовок рисуется НАД рамкой фрейма — top меньше, чем у самого узла
      vi.spyOn(titleBar, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 60,
        right: 300,
        bottom: 100,
        width: 200,
        height: 40,
      } as DOMRect);

      let styleDuringExport: string | null = null;
      const toBlobImpl = vi.fn(async (el: HTMLElement) => {
        styleDuringExport = el.style.transform;
        return new Blob(['x']);
      });

      const boardExport = useBoardExport({
        boardTitle: () => 'Доска',
        itemCount: () => 1,
        getViewportEl: () => viewportEl,
        getCanvasRect: () => canvasRect,
        project: identityProject,
        getAllNodeIds: () => ['frame-1'],
        getSelectedNodeIds: () => [],
        toBlobImpl,
      });

      await boardExport.runExport(false, 24);

      // bounds.y = 60 (заголовок), не 100 (сам узел) — translateY = -60*2 + 24 = -96
      // (bounds.x не меняется — у обоих rect'ов left=100) — translateX = -100*2 + 24 = -176
      expect(styleDuringExport).toBe('translate(-176px, -96px) scale(2)');
    });
  });
});
