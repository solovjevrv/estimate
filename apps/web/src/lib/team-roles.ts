import type { TeamRole } from '@poker/shared';

/** Цвет бейджа роли: админа выделяем, у рядовых ролей — нейтральный. */
export function roleBadgeColor(role: TeamRole): 'primary' | 'neutral' {
  if (role === 'admin') return 'primary';
  return 'neutral';
}

const AVATAR_COLOR_CLASSES = [
  'bg-primary',
  'bg-[var(--brand-amber)]',
  'bg-[var(--brand-coral)]',
  'bg-primary-700',
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
