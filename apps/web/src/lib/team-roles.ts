import type { TeamRole } from '@poker/shared';

/** Цвет бейджа роли: админа выделяем, у рядовых ролей — нейтральный. */
export function roleBadgeColor(role: TeamRole): 'primary' | 'neutral' {
  if (role === 'admin') return 'primary';
  return 'neutral';
}
