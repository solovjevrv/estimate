/**
 * Цвет стикера/фигуры/связи (12.7) — произвольный hex, а не токен из белого
 * списка (сервер валидирует формат, не членство в списке — см. `board-ops.ts`).
 * Из-за этого больше нельзя предвычислить Tailwind-классы на каждый цвет
 * (`bg-[#хардкод]` работает только для литералов, известных на этапе сборки —
 * JIT сканирует исходники, а не рантайм-значения): цвет элемента применяется
 * инлайн-стилем, а контрастный цвет текста — выбирается бинарно по относительной
 * яркости sRGB: чёрный (#1A1A1A) на светлых фонах, белый (#FFFFFF) — на
 * тёмных/насыщенных. Текстовый цвет не записывается в style при создании объекта,
 * а вычисляется реактивно из заливки, поэтому смена `color` автоматически
 * сохраняет читаемость текста.
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

/** Затемнённый вариант того же цвета для рамок фигур — по референсу `.design/main.html` */
export function darkenHex(hex: BoardColorHex, amount = 0.45): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

const TEXT_COLOR_LIGHT = '#FFFFFF';
const TEXT_COLOR_DARK = '#1A1A1A';

/**
 * Линеаризует sRGB-канал [0..1] в линейный отсвет [0..1] по формуле WCAG.
 * Каналы в диапазоне [0..0.04045] делим на 12.92, иначе применяем обратное
 * гамма-преобразование.
 */
function linearizeChannel(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * Относительная яркость sRGB по формуле WCAG:
 * 0.2126 * R + 0.7152 * G + 0.0722 * B (линейные каналы).
 */
function relativeLuminance(hex: BoardColorHex): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

/**
 * Контрастный цвет текста поверх заливки: бинарный выбор между чёрным (#1A1A1A)
 * и белым (#FFFFFF) по максимальному WCAG-коэффициенту контраста.
 *
 * Выбор основан на относительной яркости фона, а не на затемнении исходного цвета:
 * на светлых фонах возвращается чёрный текст, на тёмных/насыщенных — белый.
 * При равенстве коэффициентов выбирается чёрный цвет.
 */
export function readableTextColor(bg: BoardColorHex): string {
  const luminance = relativeLuminance(bg);
  const contrastWithDark = (luminance + 0.05) / 0.05;
  const contrastWithLight = 1.05 / (luminance + 0.05);
  return contrastWithLight > contrastWithDark ? TEXT_COLOR_LIGHT : TEXT_COLOR_DARK;
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
