/**
 * Копирование/вставка выделения через системный буфер обмена (13.5), в т.ч.
 * между досками. Формат — JSON с маркером `source`/`version` в text/plain,
 * чтобы отличать наш payload от произвольного скопированного текста и не
 * ломать обычную вставку текста в чужих приложениях/полях.
 *
 * Картинка на сервере board-scoped (URL валиден только для своей доски), так
 * что при копировании сразу тянем байты и кладём в буфер как base64 —
 * вставка тогда работает и на другой доске без обращения к исходному URL.
 * Остальные типы контента копируются как есть.
 */
import type {
  BoardEdgeStyle,
  BoardImageContent,
  BoardItemContent,
  BoardItemStyle,
} from '@poker/shared';

export const BOARD_CLIPBOARD_SOURCE = 'poker-board';
export const BOARD_CLIPBOARD_VERSION = 1;

export interface BoardClipboardImageContent {
  type: 'image';
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

export type BoardClipboardContent =
  Exclude<BoardItemContent, BoardImageContent> | BoardClipboardImageContent;

export interface BoardClipboardItem {
  content: BoardClipboardContent;
  style: BoardItemStyle;
  rotation: number;
  width: number;
  height: number;
  /** Позиция относительно центра bounding box всего скопированного выделения */
  relX: number;
  relY: number;
  /**
   * Индекс родителя-контейнера (frame/group, 14.3) В ЭТОМ ЖЕ `payload.items` —
   * `null`, если элемент верхнеуровневый или его контейнер не попал в
   * копируемый набор целиком. Индекс, а не исходный id: id при вставке
   * перегенерируется (новая доска/повторная вставка не должны сталкиваться
   * с оригиналом), а позиция внутри ЭТОГО payload — единственное стабильное
   * между copy и paste указание "чей я ребёнок".
   */
  parentIndex: number | null;
}

export interface BoardClipboardEdge {
  /** Индекс в payload.items — та же идея, что parentIndex у BoardClipboardItem */
  sourceIndex: number;
  targetIndex: number;
  sourceHandle: string | null;
  targetHandle: string | null;
  label: string | null;
  style: BoardEdgeStyle;
}

export interface BoardClipboardSourceEdge {
  sourceItemId: string;
  targetItemId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  label: string | null;
  style: BoardEdgeStyle;
}

export interface BoardClipboardPayload {
  source: typeof BOARD_CLIPBOARD_SOURCE;
  version: typeof BOARD_CLIPBOARD_VERSION;
  items: BoardClipboardItem[];
  edges: BoardClipboardEdge[];
}

export interface BoardClipboardSourceItem {
  id: string;
  /** Родитель-контейнер (frame/group, 14.3) — `null`, если верхнеуровневый.
   * Используется только для построения `parentIndex`, сам по себе в payload не идёт */
  parentId: string | null;
  content: BoardItemContent;
  style: BoardItemStyle;
  rotation: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function selectionCenter(items: readonly BoardClipboardSourceItem[]): { x: number; y: number } {
  const left = Math.min(...items.map((item) => item.x));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const top = Math.min(...items.map((item) => item.y));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/** Blob -> data URL (base64) */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('blobToBase64 failed'));
    reader.readAsDataURL(blob);
  });
}

/** data URL (base64) -> File — для повторной загрузки картинки при вставке */
export function base64ToFile(dataUrl: string, mimeType: string, fileName: string): File {
  const [, data] = dataUrl.split(',');
  if (!data) throw new Error('Invalid data URL');
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: mimeType });
}

async function serializeContent(
  content: BoardItemContent,
  fetchImpl: typeof fetch,
): Promise<BoardClipboardContent | null> {
  if (content.type !== 'image') return content;
  try {
    const response = await fetchImpl(content.url);
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);
    return {
      type: 'image',
      base64,
      mimeType: blob.type || 'image/webp',
      width: content.width,
      height: content.height,
    };
  } catch {
    // Не удалось скачать байты (сеть/CORS) — эту картинку теряем, но не роняем
    // копирование остального выделения
    return null;
  }
}

/** Сериализует выделение в JSON-строку для системного буфера (Ctrl/Cmd+C) */
export async function serializeSelection(
  items: readonly BoardClipboardSourceItem[],
  edges: readonly BoardClipboardSourceEdge[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const center = selectionCenter(items);
  const indexById = new Map(items.map((item, index) => [item.id, index]));
  const resolved = await Promise.all(
    items.map(async (item): Promise<BoardClipboardItem | null> => {
      const content = await serializeContent(item.content, fetchImpl);
      if (!content) return null;
      return {
        content,
        style: item.style,
        rotation: item.rotation,
        width: item.width,
        height: item.height,
        relX: item.x - center.x,
        relY: item.y - center.y,
        parentIndex: item.parentId !== null ? (indexById.get(item.parentId) ?? null) : null,
      };
    }),
  );
  // Индексы в payload.items должны остаться стабильными ПОСЛЕ отсева
  // несериализуемых элементов (например, картинку не удалось скачать) —
  // иначе parentIndex детей указывал бы на неверную позицию
  const oldToNewIndex = new Map<number, number>();
  const filtered: BoardClipboardItem[] = [];
  resolved.forEach((item, oldIndex) => {
    if (!item) return;
    oldToNewIndex.set(oldIndex, filtered.length);
    filtered.push(item);
  });
  for (const item of filtered) {
    if (item.parentIndex !== null) {
      item.parentIndex = oldToNewIndex.get(item.parentIndex) ?? null;
    }
  }

  // Рёбра, чей источник/цель не попали в payload.items (не сериализовались,
  // например картинку не удалось скачать) — отбрасываем: висячая в никуда
  // стрелка была бы бессмысленна
  const filteredEdges: BoardClipboardEdge[] = [];
  for (const edge of edges) {
    const sourceOld = indexById.get(edge.sourceItemId);
    const targetOld = indexById.get(edge.targetItemId);
    if (sourceOld === undefined || targetOld === undefined) continue;
    const sourceIndex = oldToNewIndex.get(sourceOld);
    const targetIndex = oldToNewIndex.get(targetOld);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    filteredEdges.push({
      sourceIndex,
      targetIndex,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      style: edge.style,
    });
  }

  const payload: BoardClipboardPayload = {
    source: BOARD_CLIPBOARD_SOURCE,
    version: BOARD_CLIPBOARD_VERSION,
    items: filtered,
    edges: filteredEdges,
  };
  return JSON.stringify(payload);
}

/**
 * Настоящее текстовое поле (input/textarea, например поле URL в тулбаре
 * выделения) — буфер там всегда должен работать как обычный текст, наш
 * формат не перехватываем никогда.
 */
export function isPlainTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
  );
}

function closestContentEditable(node: Node | null): Element | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest('[contenteditable]') ?? null;
}

/**
 * Реально выделен текст (протянут курсор) внутри ОДНОГО текстового поля, а не
 * просто коллапсированный caret. Текст стикера/фигуры/текстового блока —
 * `contenteditable` всегда (не только в момент активного редактирования), так
 * что после обычного клика на выделение элемента фокус обычно и так стоит
 * внутри contenteditable с коллапсированным caret — в этом состоянии
 * нативному copy всё равно нечего копировать, так что Ctrl+C безопасно
 * перехватывать под элемент доски.
 *
 * Shift-клик по ВТОРОМУ элементу (добавление к выделению узлов на холсте)
 * попутно расширяет и нативный DOM-selection браузера от каретки в первом
 * элементе до точки клика во втором — у него получается непустой
 * `selection.toString()` (перевод строки/пробелы между блоками), хотя
 * пользователь не выделял текст осознанно. Поэтому засчитываем только
 * выделение, чьи начало и конец лежат в одном и том же contenteditable.
 */
export function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  if (!selection.toString().trim()) return false;
  const anchorEditable = closestContentEditable(selection.anchorNode);
  const focusEditable = closestContentEditable(selection.focusNode);
  return !!anchorEditable && anchorEditable === focusEditable;
}

/** Разбирает текст из буфера в payload; `null` — не наш формат/битый JSON/чужая версия */
export function parseClipboardPayload(text: string): BoardClipboardPayload | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const items = record.items;
  if (
    record.source !== BOARD_CLIPBOARD_SOURCE ||
    record.version !== BOARD_CLIPBOARD_VERSION ||
    !Array.isArray(items)
  ) {
    return null;
  }
  // До 18.1 поле edges в payload v1 отсутствовало. Считаем его пустым, чтобы
  // данные, скопированные до обновления, по-прежнему можно было вставить.
  const rawEdges = record.edges ?? [];
  if (!Array.isArray(rawEdges)) return null;

  const edges = rawEdges.filter((edge): edge is BoardClipboardEdge => {
    if (!edge || typeof edge !== 'object') return false;
    const candidate = edge as Record<string, unknown>;
    const style = candidate.style;
    if (!style || typeof style !== 'object') return false;
    const styleRecord = style as Record<string, unknown>;
    return (
      Number.isInteger(candidate.sourceIndex) &&
      (candidate.sourceIndex as number) >= 0 &&
      (candidate.sourceIndex as number) < items.length &&
      Number.isInteger(candidate.targetIndex) &&
      (candidate.targetIndex as number) >= 0 &&
      (candidate.targetIndex as number) < items.length &&
      (typeof candidate.sourceHandle === 'string' || candidate.sourceHandle === null) &&
      (typeof candidate.targetHandle === 'string' || candidate.targetHandle === null) &&
      (typeof candidate.label === 'string' || candidate.label === null) &&
      (styleRecord.color === undefined || typeof styleRecord.color === 'string') &&
      (styleRecord.line === 'straight' ||
        styleRecord.line === 'orthogonal' ||
        styleRecord.line === 'curved') &&
      (styleRecord.markerStart === 'none' ||
        styleRecord.markerStart === 'arrow' ||
        styleRecord.markerStart === 'dot') &&
      (styleRecord.markerEnd === 'none' ||
        styleRecord.markerEnd === 'arrow' ||
        styleRecord.markerEnd === 'dot') &&
      (styleRecord.dash === undefined ||
        styleRecord.dash === null ||
        styleRecord.dash === 'solid' ||
        styleRecord.dash === 'dashed' ||
        styleRecord.dash === 'dotted') &&
      (styleRecord.curveOffset === undefined ||
        styleRecord.curveOffset === null ||
        (typeof styleRecord.curveOffset === 'object' &&
          styleRecord.curveOffset !== null &&
          typeof (styleRecord.curveOffset as { x?: unknown }).x === 'number' &&
          typeof (styleRecord.curveOffset as { y?: unknown }).y === 'number'))
    );
  });

  return {
    source: BOARD_CLIPBOARD_SOURCE,
    version: BOARD_CLIPBOARD_VERSION,
    items: items as BoardClipboardItem[],
    edges,
  };
}
