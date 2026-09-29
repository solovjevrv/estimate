import type { TeamRole } from '@estimate/shared';

/** Цвет бейджа роли: админа выделяем, у рядовых ролей — нейтральный. */
export function roleBadgeColor(role: TeamRole): 'primary' | 'neutral' {
  if (role === 'admin') return 'primary';
  return 'neutral';
}

// Фон + цвет инициалов — Accent монограммы TeamCard (50_EntityCard) и 18_Avatar:
// Brand и Brand-dark (surface-brand-pressed) с text-on-brand, Amber/Coral — сырые цвета
// кита без токена с text-on-bright в обеих темах
const AVATAR_COLOR_CLASSES = [
  'bg-surface-brand text-text-on-brand',
  'bg-[#ff8c00] text-text-on-bright',
  'bg-[#f06254] text-text-on-bright',
  'bg-surface-brand-pressed text-text-on-brand',
];

/** Детерминированный цвет аватара по id — у одной команды он всегда один и тот же. */
export function teamAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % AVATAR_COLOR_CLASSES.length;
  return AVATAR_COLOR_CLASSES[index] as string;
}
