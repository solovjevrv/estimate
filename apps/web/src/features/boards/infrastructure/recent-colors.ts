/**
 * «Недавние» кастомные цвета (18.4) — как и стикеры (recent-stickers.ts),
 * без БД, история в localStorage браузера, своя на каждом устройстве.
 * Хранит только цвета, ОТСУТСТВУЮЩИЕ в BOARD_COLOR_PALETTE — дефолтная
 * палитра и так всегда видна, дублировать её в «недавних» нет смысла.
 */
import { BOARD_COLOR_PALETTE, type BoardColorHex } from '@estimate/shared';

const STORAGE_KEY = 'estimate-board-recent-colors';
const MAX_RECENT = 8;

const DEFAULT_PALETTE_UPPER = new Set(BOARD_COLOR_PALETTE.map((hex) => hex.toUpperCase()));

function isBoardColorHex(value: unknown): value is BoardColorHex {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function getRecentColors(): BoardColorHex[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBoardColorHex);
  } catch {
    return [];
  }
}

/** Приватный режим/заполненная квота — история недавних не критична, просто пропускаем.
 * Цвет из дефолтной палитры не сохраняем — он и так всегда виден выше. */
export function addRecentColor(hex: BoardColorHex): void {
  if (DEFAULT_PALETTE_UPPER.has(hex.toUpperCase())) return;
  try {
    const withoutDuplicate = getRecentColors().filter(
      (existing) => existing.toUpperCase() !== hex.toUpperCase(),
    );
    const next = [hex, ...withoutDuplicate].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // no-op
  }
}
