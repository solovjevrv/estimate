import {
  isBoardContainer,
  type BoardEdge,
  type BoardItem,
  type BoardItemContent,
  type BoardOp,
} from '@estimate/shared';
import { nextTick } from 'vue';

import {
  base64ToFile,
  type BoardClipboardEdge,
  type BoardClipboardItem,
  type BoardClipboardSourceEdge,
  hasActiveTextSelection,
  isPlainTextField,
  parseClipboardPayload,
  serializeSelection,
} from '../../../features/boards/domain/board-clipboard';
import {
  fitImageToDefaultBox,
  maxZIndex,
} from '../../../features/boards/config/board-item-defaults';
import { BOARD_DUPLICATE_OFFSET } from '../../../features/boards/config/board-constants';
import { uuid } from '../../../features/boards/infrastructure/uuid';

export interface BoardClipboardNode {
  id: string;
  data: BoardItem;
}

interface UploadedBoardImage {
  url: string;
  width: number;
  height: number;
}

export interface UseBoardClipboardOptions {
  canEdit: () => boolean;
  getItems: () => readonly BoardItem[];
  getEdges: () => readonly BoardEdge[];
  getSelectedNodes: () => readonly BoardClipboardNode[];
  getCanvasRect: () => DOMRect | undefined;
  project: (point: { x: number; y: number }) => { x: number; y: number };
  findContainerAt: (point: { x: number; y: number }) => BoardItem | undefined;
  canCreateItems: (count: number) => boolean;
  canApplyOpsCount: (count: number) => boolean;
  uploadImage: (file: File) => Promise<UploadedBoardImage | null>;
  createImage: (center: { x: number; y: number }, file: File) => Promise<void>;
  applyOps: (ops: BoardOp[]) => void;
  breakFollowOnEdit: () => void;
  clearSelection: () => void;
  selectItems: (ids: readonly string[]) => void;
}

function internalEdges(items: readonly BoardItem[], edges: readonly BoardEdge[]): BoardEdge[] {
  const ids = new Set(items.map((item) => item.id));
  return edges.filter((edge) => ids.has(edge.sourceItemId) && ids.has(edge.targetItemId));
}

/**
 * Полный набор элементов для copy/duplicate: контейнер тянет детей, а член
 * группы — всю группу. Фрейм не тянется за одиночным дочерним элементом.
 */
export function expandContainerFamily(
  selected: readonly BoardClipboardNode[],
  items: readonly BoardItem[],
): BoardItem[] {
  const selectedIds = new Set(selected.map((node) => node.id));
  const extra = new Map<string, BoardItem>();
  const childrenOf = (containerId: string): BoardItem[] =>
    items.filter((candidate) => candidate.parentId === containerId);

  for (const node of selected) {
    if (isBoardContainer(node.data.content.type)) {
      for (const child of childrenOf(node.id)) {
        if (!selectedIds.has(child.id)) extra.set(child.id, child);
      }
      continue;
    }
    if (node.data.parentId === null) continue;

    const parent = items.find((candidate) => candidate.id === node.data.parentId);
    if (parent?.content.type !== 'group') continue;
    if (!selectedIds.has(parent.id)) extra.set(parent.id, parent);
    for (const mate of childrenOf(parent.id)) {
      if (!selectedIds.has(mate.id)) extra.set(mate.id, mate);
    }
  }

  // Родитель должен быть создан раньше ребёнка в одном batch WS.
  return [...selected.map((node) => node.data), ...extra.values()].sort(
    (a, b) => Number(isBoardContainer(b.content.type)) - Number(isBoardContainer(a.content.type)),
  );
}

/** UI-адаптер системного буфера: доменный JSON остаётся в features/boards/domain. */
export function useBoardClipboard(options: UseBoardClipboardOptions) {
  async function copy(event: ClipboardEvent): Promise<void> {
    if (!options.canEdit()) return;
    if (isPlainTextField(event.target) || hasActiveTextSelection()) return;

    const selected = options.getSelectedNodes();
    if (!selected.length) return;
    event.preventDefault();

    const sourceItems = expandContainerFamily(selected, options.getItems());
    const payload = await serializeSelection(
      sourceItems.map((item) => ({
        id: item.id,
        parentId: item.parentId,
        content: item.content,
        style: item.style,
        rotation: item.rotation,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      })),
      internalEdges(sourceItems, options.getEdges()).map((edge): BoardClipboardSourceEdge => ({
        sourceItemId: edge.sourceItemId,
        targetItemId: edge.targetItemId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        label: edge.label,
        style: edge.style,
      })),
    );
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // Буфер может быть недоступен в небезопасном контексте или без разрешения.
    }
  }

  async function pasteBoardItems(
    items: readonly BoardClipboardItem[],
    edges: readonly BoardClipboardEdge[],
  ): Promise<void> {
    options.breakFollowOnEdit();
    if (!options.canEdit() || !items.length) return;
    if (!options.canCreateItems(items.length)) return;
    if (!options.canApplyOpsCount(items.length + edges.length)) return;

    const rect = options.getCanvasRect();
    if (!rect) return;
    const viewportCenter = options.project({ x: rect.width / 2, y: rect.height / 2 });
    const baseZIndex = maxZIndex(options.getItems()) + 1;
    // Связи из вставленной группы — поверх всего на доске, включая только что
    // вставленные карточки (12.21, тот же дефолт, что у onConnect в use-board-edges.ts).
    // baseZIndex + items.length — верхняя граница zIndex ещё не созданных карточек
    // (см. item.create ниже: `zIndex: baseZIndex + index`).
    const baseEdgeZIndex = Math.max(baseZIndex + items.length, maxZIndex(options.getEdges()) + 1);
    const ops: BoardOp[] = [];
    // Индексы соответствуют исходному payload: parentIndex/edge index не должны
    // сдвигаться, если загрузка одной картинки не удалась.
    const newIds = Array<string | undefined>(items.length);

    for (const [index, item] of items.entries()) {
      let content: BoardItemContent;
      let width = item.width;
      let height = item.height;

      if (item.content.type === 'image') {
        const file = base64ToFile(item.content.base64, item.content.mimeType, `${uuid()}.webp`);
        const result = await options.uploadImage(file);
        if (!result) continue;
        const fitted = fitImageToDefaultBox(result.width, result.height);
        width = fitted.width;
        height = fitted.height;
        content = { type: 'image', url: result.url, width: result.width, height: result.height };
      } else {
        content = item.content;
      }

      const id = uuid();
      newIds[index] = id;
      const x = viewportCenter.x + item.relX - width / 2;
      const y = viewportCenter.y + item.relY - height / 2;
      const parentId = isBoardContainer(content.type)
        ? null
        : item.parentIndex !== null
          ? (newIds[item.parentIndex] ?? null)
          : (options.findContainerAt({ x: x + width / 2, y: y + height / 2 })?.id ?? null);
      ops.push({
        type: 'item.create',
        clientOpId: uuid(),
        item: {
          id,
          parentId,
          x,
          y,
          width,
          height,
          rotation: item.rotation,
          zIndex: baseZIndex + index,
          content,
          style: item.style,
          reactions: [],
        },
      });
    }

    for (const [index, edge] of edges.entries()) {
      const sourceItemId = newIds[edge.sourceIndex];
      const targetItemId = newIds[edge.targetIndex];
      if (!sourceItemId || !targetItemId) continue;
      ops.push({
        type: 'edge.create',
        clientOpId: uuid(),
        edge: {
          id: uuid(),
          sourceItemId,
          targetItemId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          label: edge.label,
          style: edge.style,
          zIndex: baseEdgeZIndex + index,
        },
      });
    }

    if (!ops.length) return;
    options.applyOps(ops);
    await nextTick();
    options.clearSelection();
    options.selectItems(newIds.filter((id): id is string => id !== undefined));
  }

  function paste(event: ClipboardEvent): void {
    if (!options.canEdit()) return;

    if (!isPlainTextField(event.target)) {
      const text = event.clipboardData?.getData('text/plain');
      const payload = text ? parseClipboardPayload(text) : null;
      if (payload) {
        event.preventDefault();
        void pasteBoardItems(payload.items, payload.edges);
        return;
      }
    }

    const clipboardItems = event.clipboardData?.items;
    if (!clipboardItems) return;
    for (const item of clipboardItems) {
      if (!item.type.startsWith('image/')) continue;
      event.preventDefault();
      const file = item.getAsFile();
      const rect = options.getCanvasRect();
      if (file && rect) {
        void options.createImage(options.project({ x: rect.width / 2, y: rect.height / 2 }), file);
      }
      break;
    }
  }

  function duplicateSelection(): void {
    const selected = options.getSelectedNodes();
    if (!selected.length) return;
    options.breakFollowOnEdit();
    const sourceItems = expandContainerFamily(selected, options.getItems());
    if (!sourceItems.length || !options.canCreateItems(sourceItems.length)) return;
    const sourceEdges = internalEdges(sourceItems, options.getEdges());
    if (!options.canApplyOpsCount(sourceItems.length + sourceEdges.length)) return;

    const baseZIndex = maxZIndex(options.getItems()) + 1;
    // См. pasteBoardItems выше — связи дубля тоже поверх всего, включая только
    // что созданные дубли карточек (12.21).
    const baseEdgeZIndex = Math.max(
      baseZIndex + sourceItems.length,
      maxZIndex(options.getEdges()) + 1,
    );
    const idMap = new Map(sourceItems.map((source) => [source.id, uuid()]));
    const itemOps: BoardOp[] = sourceItems.map((source, index) => ({
      type: 'item.create',
      clientOpId: uuid(),
      item: {
        id: idMap.get(source.id)!,
        parentId: source.parentId !== null ? (idMap.get(source.parentId) ?? source.parentId) : null,
        x: source.x + BOARD_DUPLICATE_OFFSET,
        y: source.y + BOARD_DUPLICATE_OFFSET,
        width: source.width,
        height: source.height,
        rotation: source.rotation,
        zIndex: baseZIndex + index,
        content: source.content,
        style: source.style,
        reactions: [],
      },
    }));
    const edgeOps: BoardOp[] = sourceEdges.map((edge, index) => ({
      type: 'edge.create',
      clientOpId: uuid(),
      edge: {
        id: uuid(),
        sourceItemId: idMap.get(edge.sourceItemId)!,
        targetItemId: idMap.get(edge.targetItemId)!,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        label: edge.label,
        style: edge.style,
        zIndex: baseEdgeZIndex + index,
      },
    }));
    options.applyOps([...itemOps, ...edgeOps]);
  }

  return { copy, paste, pasteBoardItems, duplicateSelection };
}
