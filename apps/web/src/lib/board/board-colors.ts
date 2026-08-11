/**
 * Цвет стикера/фигуры/связи (12.7) — произвольный hex, а не токен из белого
 * списка (сервер валидирует формат, не членство в списке — см. `board-ops.ts`).
 * Из-за этого больше нельзя предвычислить Tailwind-классы на каждый цвет
 * (`bg-[#хардкод]` работает только для литералов, известных на этапе сборки —
 * JIT сканирует исходники, а не рантайм-значения): цвет элемента применяется
 * инлайн-стилем, а «затемнённый вариант того же тона» для текста — считается
 * на лету, а не берётся из таблицы.
 */
import type { BoardColorHex } from '@poker/shared';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** #RRGGBB -> [0..1, 0..1, 0..1] */
function hexToRgb(hex: BoardColorHex): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toByte = (c: number) => Math.round(clamp01(c) * 255);
  return (
    '#' + [toByte(r), toByte(g), toByte(b)].map((b8) => b8.toString(16).padStart(2, '0')).join('')
  );
}

/** Затемнённый вариант того же цвета для текста поверх заливки — по референсу `.design/main.html` */
export function darkenHex(hex: BoardColorHex, amount = 0.45): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

/**
 * Читаемый цвет текста поверх заливки: тёмный тон того же цвета, либо
 * почти белый — у самых тёмных свотчей палитры (например, #1A1A1A)
 * затемнять уже некуда, там текст должен быть светлым, а не тёмным.
 */
export function readableTextColor(bg: BoardColorHex): string {
  const [r, g, b] = hexToRgb(bg);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.35 ? '#f5f5f5' : darkenHex(bg);
}

/**
 * Цвет курсора участника (14.1). Аватарка — произвольный URL, а не hex,
 * поэтому цвет не выводится из неё в реальном времени (это требовало бы
 * рендерить её на canvas — тяжело). Достаточно двух вариантов: у участника
 * с аватаркой — акцентный цвет темы, без неё — серый. Сам лейбл с аватаркой
 * уже даёт персональную идентификацию.
 */
export type AvatarTint = 'ink' | 'primary' | 'muted';

export function avatarTint(avatarUrl: string | null): AvatarTint {
  if (avatarUrl) return 'primary';
  return 'muted';
}
