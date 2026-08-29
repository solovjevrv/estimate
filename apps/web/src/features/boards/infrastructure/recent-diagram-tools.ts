/**
 * «Недавние» в поповере «Диаграммы» (23.3) — тот же приём, что у стикеров
 * (`recent-stickers.ts`): без БД, история в localStorage браузера, своя на
 * каждом устройстве.
 */
import type { BoardDiagramKind, BoardDiagramNotation } from '@estimate/shared';

const STORAGE_KEY = 'estimate-board-recent-diagram-tools';
const MAX_RECENT = 6;

export interface RecentDiagramToolRef {
  notation: BoardDiagramNotation;
  kind: BoardDiagramKind;
}

function isRecentDiagramToolRef(value: unknown): value is RecentDiagramToolRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RecentDiagramToolRef).notation === 'string' &&
    typeof (value as RecentDiagramToolRef).kind === 'string'
  );
}

export function getRecentDiagramTools(): RecentDiagramToolRef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentDiagramToolRef);
  } catch {
    return [];
  }
}

/** Приватный режим/заполненная квота — история недавних не критична, просто пропускаем */
export function addRecentDiagramTool(notation: BoardDiagramNotation, kind: BoardDiagramKind): void {
  try {
    const withoutDuplicate = getRecentDiagramTools().filter(
      (ref) => !(ref.notation === notation && ref.kind === kind),
    );
    const next = [{ notation, kind }, ...withoutDuplicate].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // no-op
  }
}
