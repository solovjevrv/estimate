import type { TeamRole } from '@poker/shared';

/** Цвет бейджа роли: админа выделяем, у рядовых ролей — нейтральный. */
export function roleBadgeColor(role: TeamRole): 'primary' | 'neutral' {
  if (role === 'admin') return 'primary';
  return 'neutral';
}

const TEAM_AVATAR_COLORS = [
  'var(--ui-color-primary-500)',
  'var(--brand-amber)',
  'var(--brand-coral)',
  'var(--brand-blue)',
] as const;

/** Стабильный цвет инициала команды по её id — та же команда всегда получает тот же цвет. */
export function teamAvatarColor(teamId: string): string {
  let hash = 0;
  for (let i = 0; i < teamId.length; i++) {
    hash = (hash * 31 + teamId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % TEAM_AVATAR_COLORS.length;
  return TEAM_AVATAR_COLORS[index] ?? TEAM_AVATAR_COLORS[0];
}
