import type { TeamRole } from '@poker/shared';

/** Цвет бейджа роли: владельца и админа выделяем, у рядовых ролей — нейтральный. */
export function roleBadgeColor(role: TeamRole): 'primary' | 'info' | 'neutral' {
  if (role === 'owner') return 'primary';
  if (role === 'admin') return 'info';
  return 'neutral';
}
